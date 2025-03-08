import os
import time
import uuid
import logging
import shutil
import torch
from pathlib import Path
from tempfile import NamedTemporaryFile
from fastapi import FastAPI, File, Form, UploadFile, HTTPException
from fastapi.responses import FileResponse, JSONResponse
import stable_whisper
from typing import Optional
import tempfile

# Thiết lập logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger("autoreel-api")

# Khởi tạo FastAPI
app = FastAPI(title="AutoReel API", description="API phiên âm âm thanh sử dụng stable-ts")

# Thư mục lưu trữ file tạm thời và kết quả
TEMP_DIR = Path("./temp")
OUTPUTS_DIR = Path("./outputs")

# Đảm bảo thư mục tồn tại
TEMP_DIR.mkdir(exist_ok=True)
OUTPUTS_DIR.mkdir(exist_ok=True)

# Biến toàn cục để lưu trữ mô hình
_model = None
_device = "cpu"

def get_model(force_cpu=False):
    """
    Tải và trả về mô hình stable-ts.
    
    Args:
        force_cpu (bool): Nếu True, sẽ tải mô hình trên CPU ngay cả khi GPU khả dụng
        
    Returns:
        model: Mô hình đã tải
    """
    global _model, _device
    
    # Kiểm tra nếu mô hình đã được tải
    if _model is not None:
        return _model
    
    # Xác định thiết bị để tải mô hình
    if not force_cpu and torch.cuda.is_available():
        _device = "cuda"
        logger.info(f"Sử dụng GPU: {torch.cuda.get_device_name(0)}")
        
        # Tải mô hình trên GPU
        try:
            _model = stable_whisper.load_model("turbo", device=_device)
            logger.info("Đã tải mô hình turbo trên GPU")
            return _model
        except Exception as e:
            logger.warning(f"Không thể tải mô hình trên GPU: {str(e)}")
            logger.info("Thử lại với CPU và dynamic quantization...")
            _device = "cpu"
    else:
        _device = "cpu"
        logger.info("Sử dụng CPU với dynamic quantization")
    
    # Tải mô hình trên CPU với dynamic quantization
    try:
        _model = stable_whisper.load_model("turbo", device=_device, dq=True)
        logger.info("Đã tải mô hình turbo trên CPU với dynamic quantization")
    except Exception as e:
        # Nếu không tải được turbo, thử mô hình nhỏ hơn
        logger.warning(f"Không thể tải mô hình turbo: {str(e)}")
        logger.info("Thử tải mô hình medium...")
        _model = stable_whisper.load_model("medium", device=_device, dq=True)
        logger.info("Đã tải mô hình medium")
    
    return _model

@app.on_event("startup")
async def startup_event():
    """
    Khởi tạo tài nguyên khi server bắt đầu.
    """
    # Tạo thư mục nếu chưa tồn tại
    TEMP_DIR.mkdir(exist_ok=True)
    OUTPUTS_DIR.mkdir(exist_ok=True)
    
    # Khởi tạo mô hình trước để giảm thời gian chờ cho request đầu tiên
    try:
        get_model()
        logger.info("Đã khởi tạo mô hình sẵn sàng")
    except Exception as e:
        logger.error(f"Không thể khởi tạo mô hình: {str(e)}")

@app.on_event("shutdown")
async def shutdown_event():
    """
    Dọn dẹp tài nguyên khi server tắt.
    """
    # Xóa các file tạm
    for file in TEMP_DIR.glob("*"):
        try:
            file.unlink()
        except Exception as e:
            logger.error(f"Không thể xóa file tạm {file}: {str(e)}")
    
    # Giải phóng mô hình để giải phóng bộ nhớ
    global _model
    _model = None
    
    # Gọi garbage collector
    import gc
    gc.collect()
    
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
    
    logger.info("Đã dọn dẹp tài nguyên")

@app.get("/")
async def root():
    """
    Endpoint mặc định trả về thông tin cơ bản về API.
    """
    return {
        "name": "AutoReel API",
        "description": "API phiên âm âm thanh sử dụng stable-ts",
        "endpoints": {
            "/transcribe": "POST - Phiên âm file âm thanh",
            "/download/{filename}": "GET - Tải file kết quả"
        }
    }

@app.post("/transcribe")
async def transcribe_audio(
    file: UploadFile = File(...),
    format: str = Form("txt"),
    use_cpu: bool = Form(False)
):
    """
    Nhận file âm thanh và trả về kết quả phiên âm.
    
    Args:
        file (UploadFile): File âm thanh cần phiên âm
        format (str): Định dạng output (txt, srt, vtt, ass, json)
        use_cpu (bool): Nếu True, sẽ sử dụng CPU ngay cả khi có GPU
        
    Returns:
        JSONResponse với URL download file kết quả hoặc văn bản trực tiếp
    """
    # Kiểm tra định dạng file
    supported_formats = ["mp3", "wav", "m4a", "ogg", "flac", "mp4", "avi", "mkv"]
    file_ext = file.filename.split(".")[-1].lower()
    
    if file_ext not in supported_formats:
        return JSONResponse(
            status_code=400,
            content={
                "error": f"Định dạng file không được hỗ trợ. Các định dạng hỗ trợ: {', '.join(supported_formats)}"
            }
        )
    
    # Kiểm tra định dạng đầu ra
    if format not in ["txt", "srt", "vtt", "ass", "json"]:
        return JSONResponse(
            status_code=400,
            content={
                "error": "Định dạng đầu ra không hợp lệ. Hỗ trợ: txt, srt, vtt, ass, json"
            }
        )
    
    try:
        # Lưu file tạm thời
        suffix = f".{file_ext}"
        with NamedTemporaryFile(delete=False, suffix=suffix, dir=TEMP_DIR) as temp:
            temp_file = Path(temp.name)
            shutil.copyfileobj(file.file, temp)
        
        # Lấy model (với CPU nếu yêu cầu)
        model = get_model(force_cpu=use_cpu)
        
        # Thực hiện phiên âm
        logger.info(f"Bắt đầu phiên âm file {file.filename}...")
        start_time = time.time()
        
        # Sử dụng phương pháp process_audio_with_attention_mask
        try:
            result = process_audio_with_attention_mask(model, temp_file, language="vi")
        except Exception as e:
            logger.warning(f"Không thể sử dụng xử lý attention mask tùy chỉnh: {str(e)}")
            # Quay lại phương pháp cơ bản
            logger.info("Thử lại với phương pháp phiên âm cơ bản...")
            transcribe_options = {
                "language": "vi",
            }
            
            try:
                # Thêm tùy chọn attn_implementation nếu là mô hình HF pipeline
                if hasattr(model, 'pipeline') and hasattr(model.pipeline, 'model'):
                    transcribe_options['generate_kwargs'] = {
                        'attn_implementation': 'eager'
                    }
                
                result = model.transcribe(
                    str(temp_file),
                    **transcribe_options
                )
            except Exception:
                # Nếu vẫn lỗi, thử lại với tham số tối thiểu
                logger.info("Thử lại với tham số tối thiểu...")
                result = model.transcribe(str(temp_file))
        
        process_time = time.time() - start_time
        logger.info(f"Thời gian xử lý: {process_time:.2f} giây, với thiết bị: {_device}")
        
        # Tạo tên file đầu ra
        output_filename = f"{uuid.uuid4()}.{format}"
        output_path = OUTPUTS_DIR / output_filename
        
        # Lưu kết quả theo định dạng yêu cầu
        if format == "txt":
            with open(output_path, "w", encoding="utf-8") as f:
                f.write(result.text)
        elif format == "srt":
            result.to_srt_vtt(str(output_path))
        elif format == "vtt":
            result.to_srt_vtt(str(output_path), output_format="vtt")
        elif format == "ass":
            try:
                result.to_ass(str(output_path))
                if not output_path.exists() or output_path.stat().st_size == 0:
                    raise FileNotFoundError("File ASS không được tạo hoặc kích thước bằng 0")
                logger.info(f"Đã tạo thành công file ASS: {output_path}")
            except Exception as e:
                logger.error(f"Lỗi khi xuất sang định dạng ASS: {str(e)}")
                # Thử lại với tham số rõ ràng
                logger.info("Thử lại với các tham số mặc định...")
                try:
                    result.to_ass(
                        str(output_path),
                        segment_level=True,
                        word_level=True,
                        min_dur=0.2,
                        font="Arial",
                        font_size=48
                    )
                    logger.info(f"Đã tạo thành công file ASS (phương pháp thay thế): {output_path}")
                except Exception as e2:
                    logger.error(f"Vẫn không thể tạo file ASS: {str(e2)}")
                    raise e2
        elif format == "json":
            with open(output_path, "w", encoding="utf-8") as f:
                import json
                json.dump(result.to_dict(), f, ensure_ascii=False, indent=2)
        
        # Xóa file tạm
        try:
            temp_file.unlink()
        except Exception as e:
            logger.warning(f"Không thể xóa file tạm {temp_file}: {str(e)}")
        
        # Trả về URL để tải file kết quả
        download_url = f"/download/{output_filename}"
        
        return JSONResponse(
            content={
                "success": True,
                "message": f"Đã phiên âm thành công file {file.filename}",
                "processing_time": f"{process_time:.2f} giây",
                "device": _device,
                "download_url": download_url,
                "format": format
            }
        )
    
    except RuntimeError as e:
        if "CUDA out of memory" in str(e) and not use_cpu:
            # Nếu gặp lỗi CUDA OOM và đang dùng GPU, chuyển sang CPU
            logger.warning("CUDA out of memory, chuyển sang sử dụng CPU với dynamic quantization...")
            
            # Giải phóng bộ nhớ GPU triệt để
            global _model
            if _model is not None:
                _model = None
            
            # Buộc PyTorch sử dụng CPU
            torch.cuda.empty_cache()
            
            # Tải lại mô hình trên CPU
            _model = None
            model = get_model(force_cpu=True)
            
            # Thử lại với CPU
            return await transcribe_audio(file, format, use_cpu=True)
        else:
            # Lỗi khác
            logger.error(f"Lỗi khi phiên âm: {str(e)}")
            return JSONResponse(
                status_code=500,
                content={
                    "error": f"Lỗi khi phiên âm: {str(e)}"
                }
            )
    except Exception as e:
        # Xử lý các lỗi khác
        logger.error(f"Lỗi khi xử lý: {str(e)}")
        return JSONResponse(
            status_code=500,
            content={
                "error": f"Lỗi khi xử lý: {str(e)}"
            }
        )

@app.get("/download/{filename}")
async def download_file(filename: str):
    """
    Tải file kết quả.
    
    Args:
        filename (str): Tên file cần tải
        
    Returns:
        FileResponse với file kết quả
    """
    file_path = OUTPUTS_DIR / filename
    
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File không tồn tại")
    
    # Xác định content_type dựa trên phần mở rộng
    content_type_map = {
        "txt": "text/plain",
        "srt": "text/plain",
        "vtt": "text/vtt",
        "ass": "text/plain", 
        "json": "application/json"
    }
    
    extension = filename.split(".")[-1]
    content_type = content_type_map.get(extension, "application/octet-stream")
    
    return FileResponse(
        path=file_path,
        media_type=content_type,
        filename=filename
    )

def process_audio_with_attention_mask(model, audio_path, language="vi"):
    """
    Xử lý audio với attention mask tùy chỉnh cho tiếng Việt.
    Phương pháp này giúp cải thiện độ chính xác của timestamp cho tiếng Việt.
    
    Args:
        model: Mô hình stable-ts đã tải
        audio_path: Đường dẫn đến file audio
        language: Ngôn ngữ (mặc định là "vi")
        
    Returns:
        WhisperResult: Kết quả phiên âm
    """
    # Các tùy chọn transcribe cụ thể cho tiếng Việt
    transcribe_options = {
        "language": language,
        "vad": True,                 # Sử dụng Voice Activity Detection
        "word_timestamps": True,     # Bắt buộc có timestamp ở cấp độ từng từ
        "suppress_silence": True,    # Loại bỏ khoảng im lặng
        "suppress_nonspeech": True,  # Loại bỏ âm thanh không phải giọng nói
        "vad_threshold": 0.5,        # Threshold cho VAD
        "repetition_penalty": 1.2,   # Giảm khả năng lặp từ
    }
    
    # Nếu có GPU, thêm tùy chọn tối ưu
    if _device == "cuda":
        transcribe_options["beam_size"] = 5
        
        # Kiểm tra nếu mô hình là HF pipeline, thêm attn_implementation
        if hasattr(model, 'pipeline') and hasattr(model.pipeline, 'model'):
            if not "generate_kwargs" in transcribe_options:
                transcribe_options["generate_kwargs"] = {}
            transcribe_options["generate_kwargs"]["attn_implementation"] = "eager"
    
    # Thực hiện phiên âm
    logger.debug(f"Sử dụng các tùy chọn phiên âm: {transcribe_options}")
    result = model.transcribe(
        str(audio_path),
        **transcribe_options
    )
    
    return result

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000) 