#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import os
import torch
import tempfile
import logging
import shutil
from typing import List, Optional
from pathlib import Path
from pydub import AudioSegment
import stable_whisper
from fastapi import FastAPI, UploadFile, File, Form, BackgroundTasks, HTTPException
from fastapi.responses import FileResponse, JSONResponse

# Cấu hình logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Tạo thư mục tạm cho các file
TEMP_DIR = Path("/tmp/stable_ts_tmp")
TEMP_DIR.mkdir(exist_ok=True, parents=True)

# Đường dẫn đến mô hình đã tải
MODEL_PATH = "/app/models/vinai/PhoWhisper-large"

# Khởi tạo FastAPI app
app = FastAPI(
    title="PhoWhisper-large API with Stable-ts",
    description="API để chuyển đổi âm thanh tiếng Việt thành văn bản sử dụng PhoWhisper-large và Stable-ts",
    version="1.0.0"
)

# Biến toàn cục để lưu trữ mô hình đã tải
_model = None

def get_model():
    """
    Hàm lazy-loading để khởi tạo mô hình một lần duy nhất
    """
    global _model
    if _model is None:
        logger.info("Tải mô hình PhoWhisper-large...")
        # Sử dụng GPU nếu có sẵn, nếu không thì sử dụng CPU
        device = "cuda" if torch.cuda.is_available() else "cpu"
        compute_type = "float16" if torch.cuda.is_available() else "float32"
        
        logger.info(f"Sử dụng thiết bị: {device}, compute_type: {compute_type}")
        
        try:
            _model = stable_whisper.load_hf_whisper(
                MODEL_PATH,
                device=device,
                compute_type=compute_type
            )
            logger.info("Đã tải mô hình thành công!")
        except Exception as e:
            logger.error(f"Lỗi khi tải mô hình: {str(e)}")
            raise RuntimeError(f"Không thể tải mô hình: {str(e)}")
    
    return _model

def clean_old_files():
    """
    Xóa các tệp tạm cũ trong thư mục tạm
    """
    import time
    now = time.time()
    for file_path in TEMP_DIR.glob("*"):
        # Xóa các tệp cũ hơn 1 giờ
        if now - file_path.stat().st_mtime > 3600:
            if file_path.is_file():
                file_path.unlink()
            elif file_path.is_dir():
                shutil.rmtree(file_path)

def process_audio(audio_path: str, output_formats: List[str], 
                 word_level: bool = True, segment_level: bool = True,
                 language: Optional[str] = None):
    """
    Xử lý file audio và tạo các loại đầu ra theo yêu cầu
    """
    model = get_model()
    
    # Thêm tham số language nếu được cung cấp
    transcribe_params = {}
    if language:
        transcribe_params["language"] = language
    
    # Thực hiện chuyển đổi giọng nói thành văn bản
    result = model.transcribe(audio_path, **transcribe_params)
    
    # Tạo dictionary để lưu đường dẫn đến các tệp đầu ra
    output_files = {}
    output_text = ""
    
    # Tạo các tệp đầu ra theo định dạng yêu cầu
    filename = Path(audio_path).stem
    
    if "txt" in output_formats:
        txt_path = TEMP_DIR / f"{filename}.txt"
        # Lưu văn bản đơn thuần
        with open(txt_path, "w", encoding="utf-8") as f:
            f.write(result.text)
        output_files["txt"] = str(txt_path)
        output_text = result.text
    
    if "srt" in output_formats:
        srt_path = TEMP_DIR / f"{filename}.srt"
        result.to_srt(str(srt_path))
        output_files["srt"] = str(srt_path)
        
    if "vtt" in output_formats:
        vtt_path = TEMP_DIR / f"{filename}.vtt"
        result.to_vtt(str(vtt_path))
        output_files["vtt"] = str(vtt_path)
    
    if "ass" in output_formats:
        ass_path = TEMP_DIR / f"{filename}.ass"
        result.to_ass(
            str(ass_path),
            word_level=word_level,
            segment_level=segment_level
        )
        output_files["ass"] = str(ass_path)
    
    if "json" in output_formats:
        json_path = TEMP_DIR / f"{filename}.json"
        result.save_as_json(str(json_path))
        output_files["json"] = str(json_path)
        
    return {
        "text": output_text,
        "output_files": output_files
    }

@app.on_event("startup")
async def startup_event():
    """
    Khởi tạo trước mô hình khi khởi động server
    """
    try:
        get_model()
    except Exception as e:
        logger.error(f"Lỗi khi khởi tạo mô hình: {str(e)}")

@app.get("/")
async def root():
    """
    Endpoint thông tin
    """
    device = "cuda" if torch.cuda.is_available() else "cpu"
    return {
        "name": "PhoWhisper-large Stable-ts API",
        "status": "online",
        "device": device,
        "usage": "POST /transcribe với file âm thanh để chuyển đổi thành văn bản"
    }

@app.post("/transcribe")
async def transcribe_audio(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    formats: str = Form("txt,srt,ass"),
    word_level: bool = Form(True),
    segment_level: bool = Form(True),
    language: Optional[str] = Form(None)
):
    """
    Endpoint chuyển đổi âm thanh thành văn bản
    
    - **file**: File âm thanh cần chuyển đổi
    - **formats**: Các định dạng đầu ra, phân cách bằng dấu phẩy (txt,srt,vtt,ass,json)
    - **word_level**: Có hiển thị timestamp cấp từ trong ASS hay không
    - **segment_level**: Có hiển thị timestamp cấp đoạn trong ASS hay không
    - **language**: Ngôn ngữ của âm thanh (mặc định: tự động phát hiện)
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
        
        # Chuyển đổi các định dạng đầu ra thành list
        output_formats = [fmt.strip().lower() for fmt in formats.split(",")]
        valid_formats = ["txt", "srt", "vtt", "ass", "json"]
        output_formats = [fmt for fmt in output_formats if fmt in valid_formats]
        
        if not output_formats:
            output_formats = ["txt"]  # Mặc định là văn bản thuần
        
        # Xử lý file âm thanh
        result = process_audio(
            str(temp_file), 
            output_formats,
            word_level=word_level,
            segment_level=segment_level,
            language=language
        )
        
        # Thêm nhiệm vụ dọn dẹp tệp cũ
        background_tasks.add_task(clean_old_files)
        
        return result
        
    except Exception as e:
        logger.error(f"Lỗi khi xử lý file âm thanh: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Lỗi khi xử lý: {str(e)}"
        )

@app.get("/download/{file_format}/{filename}")
async def download_file(file_format: str, filename: str):
    """
    Endpoint tải xuống file kết quả
    
    - **file_format**: Định dạng file (txt, srt, vtt, ass, json)
    - **filename**: Tên file không có phần mở rộng
    """
    if file_format not in ["txt", "srt", "vtt", "ass", "json"]:
        raise HTTPException(
            status_code=400,
            detail="Định dạng file không hợp lệ"
        )
    
    file_path = TEMP_DIR / f"{filename}.{file_format}"
    
    if not file_path.exists():
        raise HTTPException(
            status_code=404,
            detail="File không tồn tại"
        )
    
    return FileResponse(
        path=file_path,
        media_type="application/octet-stream",
        filename=f"{filename}.{file_format}"
    )

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
