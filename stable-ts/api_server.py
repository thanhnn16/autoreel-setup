#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import os
import torch
import tempfile
import logging
from pathlib import Path
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Query
from fastapi.responses import FileResponse
import stable_whisper
import gc

# Cấu hình logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Tạo thư mục tạm cho các file
TEMP_DIR = Path("/tmp/stable_ts_tmp")
TEMP_DIR.mkdir(exist_ok=True, parents=True)

# Khởi tạo FastAPI app
app = FastAPI(
    title="Stable-ts API",
    description="API để chuyển đổi âm thanh thành văn bản sử dụng Stable-ts",
    version="1.0.0"
)

# Biến toàn cục để lưu trữ mô hình đã tải
_model = None
_device = None

def get_model(force_cpu=False):
    """
    Hàm lazy-loading để khởi tạo mô hình một lần duy nhất
    
    Args:
        force_cpu (bool): Nếu True, sẽ sử dụng CPU ngay cả khi có GPU
    """
    global _model, _device
    
    # Nếu yêu cầu chạy trên CPU hoặc không có GPU
    if force_cpu or not torch.cuda.is_available():
        device = "cpu"
        compute_type = "float32"
        use_dq = True  # Kích hoạt dynamic quantization cho CPU
    else:
        device = "cuda"
        compute_type = "float16"
        use_dq = False  # Dynamic quantization chỉ hoạt động trên CPU
    
    # Nếu đã có mô hình nhưng yêu cầu đổi thiết bị
    if _model is not None and _device != device:
        logger.info(f"Chuyển mô hình từ {_device} sang {device}")
        # Giải phóng bộ nhớ GPU nếu có
        if _device == "cuda":
            _model = None
            torch.cuda.empty_cache()
            gc.collect()
    
    # Nếu chưa có mô hình hoặc đã giải phóng mô hình
    if _model is None:
        logger.info(f"Tải mô hình với thiết bị: {device}, compute_type: {compute_type}, dynamic_quantization: {use_dq}")
        _device = device
        
        try:
            # Sử dụng mô hình vi-whisper-large-v3-turbo từ HuggingFace với dynamic quantization khi chạy trên CPU
            _model = stable_whisper.load_hf_whisper(
                'suzii/vi-whisper-large-v3-turbo', 
                device=device, 
                compute_type=compute_type,
                dq=use_dq  # Kích hoạt dynamic quantization
            )
            logger.info("Đã tải mô hình tiếng Việt thành công!")
            
        except Exception as e:
            logger.error(f"Lỗi khi tải mô hình: {str(e)}")
            raise RuntimeError(f"Không thể tải mô hình: {str(e)}")
    
    return _model

@app.on_event("startup")
async def startup_event():
    """
    Khởi tạo trước mô hình khi khởi động server
    """
    try:
        # Không khởi tạo trước mô hình để tránh sử dụng bộ nhớ GPU không cần thiết
        # get_model()
        pass
    except Exception as e:
        logger.error(f"Lỗi khi khởi tạo mô hình: {str(e)}")

@app.get("/")
async def root():
    """
    Endpoint thông tin
    """
    device = "cuda" if torch.cuda.is_available() else "cpu"
    return {
        "name": "Stable-ts API",
        "status": "online",
        "device": device,
        "usage": "POST /transcribe với file âm thanh để chuyển đổi thành văn bản"
    }

@app.post("/transcribe")
async def transcribe_audio(
    file: UploadFile = File(...),
    format: str = Form("txt"),
    use_cpu: bool = Form(False)
):
    """
    Endpoint chuyển đổi âm thanh thành văn bản
    
    - **file**: File âm thanh cần chuyển đổi
    - **format**: Định dạng đầu ra (txt, srt, vtt, ass)
    - **use_cpu**: Sử dụng CPU thay vì GPU để tránh lỗi bộ nhớ
    """
    # Kiểm tra định dạng file
    if not file.filename.lower().endswith(('.mp3', '.wav', '.ogg', '.flac', '.m4a', '.aac')):
        raise HTTPException(
            status_code=400,
            detail="Định dạng file không được hỗ trợ. Vui lòng tải lên file âm thanh (.mp3, .wav, .ogg, .flac, .m4a, .aac)"
        )
    
    try:
        # Lưu file tải lên vào thư mục tạm
        temp_file = TEMP_DIR / file.filename
        with open(temp_file, "wb") as f:
            f.write(await file.read())
        
        # Kiểm tra định dạng đầu ra
        if format not in ["txt", "srt", "vtt", "ass"]:
            format = "txt"  # Mặc định là văn bản thuần
        
        # Cố gắng xử lý file âm thanh
        try:
            # Thử sử dụng GPU nếu không yêu cầu CPU
            model = get_model(force_cpu=use_cpu)
            result = model.transcribe(str(temp_file))
        except RuntimeError as e:
            if "CUDA out of memory" in str(e) and not use_cpu:
                # Nếu gặp lỗi CUDA OOM và đang dùng GPU, chuyển sang CPU
                logger.warning("CUDA out of memory, chuyển sang sử dụng CPU với dynamic quantization...")
                # Giải phóng bộ nhớ GPU
                torch.cuda.empty_cache()
                gc.collect()
                # Tải lại mô hình trên CPU với dynamic quantization
                model = get_model(force_cpu=True)
                result = model.transcribe(str(temp_file))
            else:
                # Nếu là lỗi khác, ném ngoại lệ
                raise
        
        # Tạo file output
        output_file = TEMP_DIR / f"{temp_file.stem}.{format}"
        
        # Xuất file theo định dạng
        if format == "txt":
            with open(output_file, "w", encoding="utf-8") as f:
                f.write(result.text)
        elif format == "srt":
            result.to_srt(str(output_file))
        elif format == "vtt":
            result.to_vtt(str(output_file))
        elif format == "ass":
            result.to_ass(str(output_file))
        
        # Trả về nội dung văn bản và đường dẫn đến file
        return {
            "text": result.text,
            "file_path": str(output_file),
            "device_used": "cpu" if use_cpu or _device == "cpu" else "cuda",
            "dynamic_quantization": use_cpu or _device == "cpu"  # Thêm thông tin về dynamic quantization
        }
        
    except Exception as e:
        logger.error(f"Lỗi khi xử lý file âm thanh: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Lỗi khi xử lý: {str(e)}"
        )

@app.get("/download/{filename}")
async def download_file(filename: str):
    """
    Endpoint tải xuống file kết quả
    
    - **filename**: Tên file có phần mở rộng
    """
    file_path = TEMP_DIR / filename
    
    if not file_path.exists():
        raise HTTPException(
            status_code=404,
            detail="File không tồn tại"
        )
    
    return FileResponse(
        path=file_path,
        media_type="application/octet-stream",
        filename=filename
    )

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
