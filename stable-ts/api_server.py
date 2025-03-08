from fastapi import FastAPI, UploadFile, File, HTTPException, Request, Form, Query
import stable_whisper
import tempfile
import os
import logging
import torch
import gc
import random
import json
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from typing import List, Optional
from collections import deque
import time

# Cấu hình logging
logging.basicConfig(level=logging.INFO, 
                   format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Lưu trữ logs trong bộ nhớ
memory_logs = deque(maxlen=1000)  # Giữ tối đa 1000 log gần nhất

# Handler tùy chỉnh để lưu logs vào bộ nhớ
class MemoryLogHandler(logging.Handler):
    def emit(self, record):
        log_entry = {
            'timestamp': time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(record.created)),
            'level': record.levelname,
            'message': record.getMessage(),
            'module': record.module
        }
        memory_logs.append(log_entry)

# Thêm handler vào logger
memory_handler = MemoryLogHandler()
logger.addHandler(memory_handler)

app = FastAPI(title="Stable-TS API Server", 
             description="API server cho Stable-TS với PhoWhisper-large")

# Thêm CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Cấu hình PyTorch để tối ưu bộ nhớ
os.environ["PYTORCH_CUDA_ALLOC_CONF"] = "expandable_segments:True"

# Tải PhoWhisper-Large từ thư mục đã tải về
try:
    # Sử dụng load_hf_whisper để tải mô hình PhoWhisper-large từ VINAI
    model = stable_whisper.load_hf_whisper("vinai/PhoWhisper-large", device="cuda", compute_type="int8")
    logger.info("Đã tải model PhoWhisper-large từ VINAI thành công")
except Exception as e:
    logger.error(f"Lỗi khi tải model: {str(e)}")
    model = None

# Middleware để log request body
@app.middleware("http")
async def log_requests(request: Request, call_next):
    logger.info(f"Nhận request {request.method} {request.url}")
    start_time = time.time()
    try:
        response = await call_next(request)
        process_time = time.time() - start_time
        logger.info(f"Trả về response với status code: {response.status_code} trong {process_time:.2f} giây")
        return response
    except Exception as e:
        logger.error(f"Lỗi xử lý request: {str(e)}")
        return JSONResponse(
            status_code=500,
            content={"error": str(e), "detail": "Lỗi server khi xử lý request"}
        )

@app.post("/transcribe")
async def transcribe(
    file: UploadFile = File(...), 
    device: str = Form("cuda"),
    vad: bool = Form(True),
    denoiser: Optional[str] = Form(None),
    vad_threshold: float = Form(0.35),
    batch_size: int = Form(8),
    word_timestamps: bool = Form(True),
    compute_type: str = Form("int8")
):
    """
    Chuyển đổi giọng nói thành văn bản với PhoWhisper-large.
    
    - **file**: File âm thanh cần chuyển đổi
    - **device**: Thiết bị xử lý (cuda hoặc cpu)
    - **vad**: Sử dụng Silero VAD để phát hiện giọng nói chính xác hơn
    - **denoiser**: Sử dụng denoiser để lọc nhiễu (demucs hoặc None)
    - **vad_threshold**: Ngưỡng phát hiện giọng nói với Silero VAD
    - **batch_size**: Kích thước batch để tiết kiệm bộ nhớ
    - **word_timestamps**: Tạo timestamp cho từng từ
    - **compute_type**: Loại tính toán (int8, float16, float32)
    """
    # Kiểm tra model đã được tải chưa
    if model is None:
        logger.error("Model chưa được tải, không thể xử lý transcribe")
        raise HTTPException(status_code=500, detail="Model chưa được tải")
    
    # Kiểm tra file có tồn tại không
    if not file:
        logger.error("Không tìm thấy file trong request")
        raise HTTPException(status_code=400, detail="Không tìm thấy file trong request")
    
    # Kiểm tra file có phải là audio không
    audio_extensions = ['.mp3', '.wav', '.ogg', '.flac', '.m4a', '.aac']
    file_ext = os.path.splitext(file.filename)[1].lower() if file.filename else ""
    if file_ext not in audio_extensions:
        logger.error(f"File không phải định dạng audio hỗ trợ: {file.filename}")
        raise HTTPException(
            status_code=400, 
            detail=f"File phải là định dạng audio ({', '.join(audio_extensions)})"
        )
    
    try:
        # Dọn dẹp bộ nhớ CUDA trước khi xử lý
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
            gc.collect()
            logger.info(f"Bộ nhớ CUDA trước khi xử lý: {torch.cuda.memory_allocated()/1024**2:.2f} MB / {torch.cuda.get_device_properties(0).total_memory/1024**3:.2f} GB")
        
        # Chọn thiết bị xử lý (CPU nếu GPU hết bộ nhớ)
        use_device = device
        if device == "cuda" and torch.cuda.is_available():
            # Kiểm tra bộ nhớ GPU còn trống
            free_memory = torch.cuda.get_device_properties(0).total_memory - torch.cuda.memory_allocated()
            if free_memory < 500 * 1024 * 1024:  # Nếu còn ít hơn 500MB
                logger.warning("GPU memory is low, switching to CPU")
                use_device = "cpu"
        
        # Lưu file audio tạm thời trên đĩa
        with tempfile.NamedTemporaryFile(delete=False, suffix=file_ext) as tmp:
            logger.info(f"Đang lưu file tạm: {tmp.name}")
            content = await file.read()
            if not content:
                logger.error("File rỗng")
                raise HTTPException(status_code=400, detail="File rỗng")
            
            tmp.write(content)
            tmp.flush()
            
            # Log kích thước file
            file_size = os.path.getsize(tmp.name)
            logger.info(f"Kích thước file: {file_size} bytes")
            
            try:
                # Thiết lập seed cố định nếu sử dụng demucs để có kết quả nhất quán
                if denoiser == "demucs":
                    random.seed(0)
                    logger.info("Đã thiết lập random seed=0 cho demucs")
                
                # Chuyển đổi giọng nói sang văn bản với tiếng Việt
                logger.info(f"Bắt đầu transcribe trên thiết bị: {use_device} với vad={vad}, denoiser={denoiser}")
                
                # Thiết lập các tham số để giảm sử dụng bộ nhớ
                result = model.transcribe(
                    tmp.name, 
                    language="vi",
                    vad_filter=vad,  # Lọc các đoạn không có giọng nói
                    vad_threshold=vad_threshold,  # Ngưỡng phát hiện giọng nói
                    batch_size=batch_size,  # Giảm batch size để tiết kiệm bộ nhớ
                    word_timestamps=word_timestamps,  # Tạo timestamp cho từng từ
                    compute_type=compute_type,  # Sử dụng int8 để tiết kiệm bộ nhớ
                    denoiser=denoiser  # Sử dụng denoiser nếu được chỉ định
                )
                logger.info("Transcribe thành công")
                
                # Xuất kết quả ở các định dạng khác nhau
                ass_output = result.to_ass()
                srt_output = result.to_srt_vtt(word_level=False)
                word_srt_output = result.to_srt_vtt(segment_level=False)
                
                logger.info("Tạo phụ đề thành công")
                
                # Xóa file tạm sau khi xử lý xong
                os.unlink(tmp.name)
                logger.info(f"Đã xóa file tạm: {tmp.name}")
                
                # Dọn dẹp bộ nhớ CUDA sau khi xử lý
                if torch.cuda.is_available():
                    torch.cuda.empty_cache()
                    gc.collect()
                    logger.info(f"Bộ nhớ CUDA sau khi xử lý: {torch.cuda.memory_allocated()/1024**2:.2f} MB / {torch.cuda.get_device_properties(0).total_memory/1024**3:.2f} GB")
                
                # Trả về kết quả đầy đủ
                return {
                    "text": result.text, 
                    "ass": ass_output, 
                    "srt": srt_output,
                    "word_srt": word_srt_output,
                    "device_used": use_device,
                    "segments": result.to_dict().get("segments", []),
                    "language": "vi",
                    "processing_info": {
                        "vad_used": vad,
                        "denoiser_used": denoiser,
                        "word_timestamps": word_timestamps,
                        "compute_type": compute_type
                    }
                }
            except Exception as e:
                logger.error(f"Lỗi khi xử lý transcribe: {str(e)}")
                
                # Nếu lỗi CUDA out of memory và đang dùng GPU, thử lại với CPU
                if "CUDA out of memory" in str(e) and use_device == "cuda":
                    logger.info("Thử lại với CPU do GPU hết bộ nhớ")
                    try:
                        # Dọn dẹp bộ nhớ
                        torch.cuda.empty_cache()
                        gc.collect()
                        
                        # Thử lại với CPU
                        result = model.transcribe(
                            tmp.name, 
                            language="vi",
                            vad_filter=vad,
                            vad_threshold=vad_threshold,
                            word_timestamps=word_timestamps,
                            compute_type="float32",  # CPU thường dùng float32
                            denoiser=denoiser
                        )
                        
                        # Xuất kết quả ở các định dạng khác nhau
                        ass_output = result.to_ass()
                        srt_output = result.to_srt_vtt(word_level=False)
                        word_srt_output = result.to_srt_vtt(segment_level=False)
                        
                        # Xóa file tạm
                        os.unlink(tmp.name)
                        
                        return {
                            "text": result.text, 
                            "ass": ass_output, 
                            "srt": srt_output,
                            "word_srt": word_srt_output,
                            "device_used": "cpu (fallback)",
                            "segments": result.to_dict().get("segments", []),
                            "language": "vi",
                            "processing_info": {
                                "vad_used": vad,
                                "denoiser_used": denoiser,
                                "word_timestamps": word_timestamps,
                                "compute_type": "float32"
                            }
                        }
                    except Exception as cpu_e:
                        logger.error(f"Lỗi khi thử lại với CPU: {str(cpu_e)}")
                        raise HTTPException(status_code=500, detail=f"Lỗi khi xử lý transcribe với CPU: {str(cpu_e)}")
                
                raise HTTPException(status_code=500, detail=f"Lỗi khi xử lý transcribe: {str(e)}")
    except Exception as e:
        logger.error(f"Lỗi khi xử lý file: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Lỗi khi xử lý file: {str(e)}")

@app.get("/health")
async def health_check():
    """
    Kiểm tra trạng thái hoạt động của API server
    """
    if model is None:
        return {"status": "error", "message": "Model chưa được tải"}
    
    # Thêm thông tin về bộ nhớ GPU
    memory_info = {}
    if torch.cuda.is_available():
        memory_info = {
            "total_memory_gb": torch.cuda.get_device_properties(0).total_memory / (1024**3),
            "allocated_memory_mb": torch.cuda.memory_allocated() / (1024**2),
            "free_memory_mb": (torch.cuda.get_device_properties(0).total_memory - torch.cuda.memory_allocated()) / (1024**2)
        }
    
    return {
        "status": "ok", 
        "message": "API đang hoạt động bình thường",
        "model": "vinai/PhoWhisper-large",
        "gpu_memory": memory_info
    }

@app.post("/clear_memory")
async def clear_memory():
    """
    Dọn dẹp bộ nhớ CUDA
    """
    if torch.cuda.is_available():
        before = torch.cuda.memory_allocated() / (1024**2)
        torch.cuda.empty_cache()
        gc.collect()
        after = torch.cuda.memory_allocated() / (1024**2)
        return {
            "status": "success",
            "message": f"Đã dọn dẹp bộ nhớ CUDA",
            "memory_before_mb": before,
            "memory_after_mb": after
        }
    return {"status": "info", "message": "CUDA không khả dụng"}

@app.get("/logs")
async def get_logs(
    limit: int = Query(100, description="Số lượng log muốn lấy"),
    level: Optional[str] = Query(None, description="Lọc theo cấp độ log (INFO, ERROR, WARNING)")
):
    """
    Lấy logs từ hệ thống
    
    - **limit**: Số lượng log muốn lấy (mặc định: 100)
    - **level**: Lọc theo cấp độ log (INFO, ERROR, WARNING)
    """
    filtered_logs = list(memory_logs)
    
    # Lọc theo cấp độ nếu được chỉ định
    if level:
        filtered_logs = [log for log in filtered_logs if log['level'] == level.upper()]
    
    # Giới hạn số lượng log trả về
    return {"logs": filtered_logs[-limit:]}

@app.get("/model_info")
async def model_info():
    """
    Lấy thông tin về mô hình đang được sử dụng
    """
    if model is None:
        return {"status": "error", "message": "Model chưa được tải"}
    
    return {
        "model_name": "vinai/PhoWhisper-large",
        "language": "vi",
        "description": "PhoWhisper là mô hình ASR được tinh chỉnh từ Whisper cho tiếng Việt, được phát triển bởi VinAI Research",
        "features": [
            "Hỗ trợ nhiều giọng địa phương tiếng Việt",
            "Độ chính xác cao cho tiếng Việt",
            "Tạo timestamp chính xác cho từng từ"
        ],
        "paper": "https://arxiv.org/abs/2401.03230",
        "homepage": "https://huggingface.co/vinai/PhoWhisper-large"
    }
