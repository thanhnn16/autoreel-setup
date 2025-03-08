from fastapi import FastAPI, UploadFile, File, HTTPException, Request, Form
import stable_whisper
import tempfile
import os
import logging
import torch
import gc
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware

# Cấu hình logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI()

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
    model = stable_whisper.load_model("large-v3", device="cuda")
    logger.info("Đã tải model thành công")
except Exception as e:
    logger.error(f"Lỗi khi tải model: {str(e)}")
    model = None

# Middleware để log request body
@app.middleware("http")
async def log_requests(request: Request, call_next):
    logger.info(f"Nhận request {request.method} {request.url}")
    try:
        response = await call_next(request)
        logger.info(f"Trả về response với status code: {response.status_code}")
        return response
    except Exception as e:
        logger.error(f"Lỗi xử lý request: {str(e)}")
        return JSONResponse(
            status_code=500,
            content={"error": str(e), "detail": "Lỗi server khi xử lý request"}
        )

@app.post("/transcribe")
async def transcribe(file: UploadFile = File(...), device: str = Form("cuda")):
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
                # Chuyển đổi giọng nói sang văn bản với tiếng Việt
                logger.info(f"Bắt đầu transcribe trên thiết bị: {use_device}")
                
                # Thiết lập các tham số để giảm sử dụng bộ nhớ
                result = model.transcribe(
                    tmp.name, 
                    language="vi",
                    device=use_device,
                    vad_filter=True,  # Lọc các đoạn không có giọng nói
                    batch_size=8,     # Giảm batch size để tiết kiệm bộ nhớ
                    compute_type="int8" if use_device == "cuda" else "float32"  # Sử dụng int8 để tiết kiệm bộ nhớ
                )
                logger.info("Transcribe thành công")
                
                # Xuất kết quả ở định dạng ASS
                ass_output = result.to_ass()
                logger.info("Tạo phụ đề ASS thành công")
                
                # Xóa file tạm sau khi xử lý xong
                os.unlink(tmp.name)
                logger.info(f"Đã xóa file tạm: {tmp.name}")
                
                # Dọn dẹp bộ nhớ CUDA sau khi xử lý
                if torch.cuda.is_available():
                    torch.cuda.empty_cache()
                    gc.collect()
                    logger.info(f"Bộ nhớ CUDA sau khi xử lý: {torch.cuda.memory_allocated()/1024**2:.2f} MB / {torch.cuda.get_device_properties(0).total_memory/1024**3:.2f} GB")
                
                return {"text": result.text, "ass": ass_output, "device_used": use_device}
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
                            device="cpu",
                            vad_filter=True
                        )
                        ass_output = result.to_ass()
                        
                        # Xóa file tạm
                        os.unlink(tmp.name)
                        
                        return {"text": result.text, "ass": ass_output, "device_used": "cpu (fallback)"}
                    except Exception as cpu_e:
                        logger.error(f"Lỗi khi thử lại với CPU: {str(cpu_e)}")
                        raise HTTPException(status_code=500, detail=f"Lỗi khi xử lý transcribe với CPU: {str(cpu_e)}")
                
                raise HTTPException(status_code=500, detail=f"Lỗi khi xử lý transcribe: {str(e)}")
    except Exception as e:
        logger.error(f"Lỗi khi xử lý file: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Lỗi khi xử lý file: {str(e)}")

@app.get("/health")
async def health_check():
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
        "gpu_memory": memory_info
    }

@app.post("/clear_memory")
async def clear_memory():
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
