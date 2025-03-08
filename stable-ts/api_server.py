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
from stable_whisper import WhisperResult
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
    else:
        _device = "cpu"
        logger.info("Sử dụng CPU")
    
    # Tải mô hình đơn giản
    try:
        _model = stable_whisper.load_model("turbo", device=_device)
        logger.info(f"Đã tải mô hình turbo trên {_device}")
    except Exception as e:
        logger.warning(f"Không thể tải mô hình turbo: {str(e)}")
        logger.info("Thử tải mô hình medium...")
        _model = stable_whisper.load_model("medium", device=_device)
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
        },
        "features": {
            "segment_by_sentence": "Tính năng ngắt theo câu để có context tốt nhất",
            "supported_formats": ["txt", "srt", "vtt", "ass", "json", "sentence"],
            "supported_audio": ["mp3", "wav", "m4a", "ogg", "flac", "mp4", "avi", "mkv"]
        },
        "version": "1.1.0"
    }

@app.post("/transcribe")
async def transcribe_audio(
    file: UploadFile = File(...),
    format: str = Form("txt"),
    use_cpu: bool = Form(False),
    segment_by_sentence: bool = Form(True),
    font_size: int = Form(12),
    font: str = Form("Arial"),
    margin_v: int = Form(10)
):
    """
    API endpoint để phiên âm file audio thành văn bản.
    
    Args:
        file (UploadFile): File audio cần phiên âm
        format (str): Định dạng đầu ra (txt, srt, vtt, json, sentence)
        use_cpu (bool): Sử dụng CPU thay vì GPU
        segment_by_sentence (bool): Ngắt segment theo câu để có context tốt hơn
        font_size (int): Kích thước font cho file ASS (mặc định: 12)
        font (str): Tên font chữ cho file ASS (mặc định: Arial)
        margin_v (int): Lề dọc cho file ASS (mặc định: 10)
        
    Returns:
        Kết quả phiên âm theo định dạng yêu cầu
    """
    
    # Ghi log request
    logger.info(f"Nhận yêu cầu phiên âm file: {file.filename}, format: {format}, use_cpu: {use_cpu}, segment_by_sentence: {segment_by_sentence}, font_size: {font_size}, font: {font}, margin_v: {margin_v}")
    
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
    
    # Chuẩn hóa và kiểm tra định dạng đầu ra
    format = format.lower().strip()
    logger.info(f"Định dạng đầu ra sau khi chuẩn hóa: {format}")
    
    if format not in ["txt", "srt", "vtt", "ass", "json", "sentence"]:
        return JSONResponse(
            status_code=400,
            content={
                "error": "Định dạng đầu ra không hợp lệ. Hỗ trợ: txt, srt, vtt, ass, json, sentence"
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
        
        # Sử dụng phương pháp đơn giản theo hướng dẫn từ stable-ts
        try:
            result = process_audio_with_attention_mask(
                model, 
                temp_file, 
                language="vi", 
                regroup=segment_by_sentence
            )
        except Exception as e:
            logger.error(f"Không thể phiên âm: {str(e)}")
            raise
        
        process_time = time.time() - start_time
        logger.info(f"Thời gian xử lý: {process_time:.2f} giây, với thiết bị: {_device}")
        
        # Xử lý đặc biệt cho định dạng sentence
        if format == "sentence":
            # Trả về JSON trực tiếp với các segment câu
            sentence_segments = extract_sentence_segments(result)
            return JSONResponse(
                content={
                    "success": True,
                    "message": f"Đã phiên âm thành công file {file.filename}",
                    "processing_time": f"{process_time:.2f} giây",
                    "device": _device,
                    "text": result.text,
                    "segments": sentence_segments,
                    "segment_count": len(sentence_segments),
                    "segment_by_sentence": segment_by_sentence,
                    "regroup_history": result.regroup_history if hasattr(result, 'regroup_history') else ""
                }
            )
        
        # Tạo tên file đầu ra
        output_filename = f"{uuid.uuid4()}.{format}"
        output_path = OUTPUTS_DIR / output_filename
        
        logger.info(f"Tạo file đầu ra: {output_path} với định dạng {format}")
        
        # Lưu kết quả theo định dạng yêu cầu
        if format == "txt":
            with open(output_path, "w", encoding="utf-8") as f:
                f.write(result.text)
        elif format == "srt":
            result.to_srt_vtt(str(output_path))
        elif format == "vtt":
            result.to_srt_vtt(str(output_path), output_format="vtt")
        elif format == "ass":
            # Sử dụng phương thức đơn giản theo hướng dẫn từ stable-ts
            # Hàm to_ass() mặc định đã hỗ trợ hiển thị cả segment và word-level
            try:
                # Sử dụng các tham số đúng theo tài liệu
                result.to_ass(
                    str(output_path),
                    font_size=font_size,
                    font=font,
                    MarginV=margin_v
                )
            except AttributeError as e:
                if "'WordTiming' object has no attribute 'text'" in str(e):
                    logger.error(f"Lỗi khi xử lý: {str(e)}")
                    # Chuyển đổi từ WordTiming sang định dạng chứa thuộc tính text
                    for segment in result.segments:
                        if hasattr(segment, 'words') and segment.words:
                            # Kiểm tra và chuyển đổi các words nếu không có thuộc tính text
                            for i, word in enumerate(segment.words):
                                if not hasattr(word, 'text') and hasattr(word, 'word'):
                                    # Sử dụng thuộc tính word nếu không có thuộc tính text
                                    word.text = word.word
                    # Thử lại sau khi sửa với các tham số đã chỉ định
                    result.to_ass(
                        str(output_path),
                        font_size=font_size,
                        font=font,
                        MarginV=margin_v
                    )
                else:
                    raise
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
        
        logger.info(f"Hoàn thành phiên âm. URL tải xuống: {download_url}, định dạng: {format}")
        
        # Trích xuất segments để trả về trong response nếu định dạng là ass
        response_content = {
            "success": True,
            "message": f"Đã phiên âm thành công file {file.filename}",
            "processing_time": f"{process_time:.2f} giây",
            "device": _device,
            "download_url": download_url,
            "format": format,
            "text": result.text  # Thêm nội dung text vào response cho tất cả các định dạng
        }
        
        # Thêm segments vào response nếu định dạng là ass
        if format == "ass":
            sentence_segments = extract_sentence_segments(result)
            response_content["segments"] = sentence_segments
        
        return JSONResponse(
            content=response_content
        )
    
    except RuntimeError as e:
        if "CUDA out of memory" in str(e) and not use_cpu:
            # Nếu gặp lỗi CUDA OOM và đang dùng GPU, chuyển sang CPU
            logger.warning("CUDA out of memory, chuyển sang sử dụng CPU...")
            
            # Giải phóng bộ nhớ GPU
            global _model
            _model = None
            torch.cuda.empty_cache()
            
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
        logger.error(f"File không tồn tại: {file_path}")
        raise HTTPException(status_code=404, detail="File không tồn tại")
    
    # Kiểm tra kích thước file
    file_size = file_path.stat().st_size
    if file_size == 0:
        logger.error(f"File trống: {file_path}, kích thước: {file_size}")
        raise HTTPException(status_code=404, detail="File trống, vui lòng thử lại")
    
    # Xác định content_type dựa trên phần mở rộng
    content_type_map = {
        "txt": "text/plain",
        "srt": "text/plain",
        "vtt": "text/vtt",
        "ass": "text/plain", 
        "json": "application/json"
    }
    
    extension = filename.split(".")[-1].lower()
    logger.info(f"Tải xuống file: {filename}, định dạng: {extension}")
    content_type = content_type_map.get(extension, "application/octet-stream")
    
    return FileResponse(
        path=file_path,
        media_type=content_type,
        filename=filename
    )

def process_audio_with_attention_mask(model, audio_path, language="vi", regroup=True):
    """
    Xử lý audio theo hướng dẫn đơn giản từ stable-ts.
    
    Args:
        model: Mô hình stable-ts đã tải
        audio_path: Đường dẫn đến file audio
        language: Ngôn ngữ (mặc định là "vi")
        regroup: Sử dụng thuật toán phân nhóm lại các từ (mặc định: True)
        
    Returns:
        WhisperResult: Kết quả phiên âm
    """
    # Thực hiện phiên âm với word_timestamps=True để có timestamps cho từng từ
    result = model.transcribe(str(audio_path), language=language, regroup=regroup)
    
    # Nếu bật regroup, thực hiện các bước nhóm theo câu hoàn chỉnh
    if regroup:
        # Đầu tiên, gộp tất cả các segments lại
        result = result.merge_all_segments()
        
        # Kết hợp các segments thành các câu hoàn chỉnh theo các dấu câu tiếng Việt
        # Các dấu câu kết thúc câu: dấu chấm, dấu chấm hỏi, dấu chấm than
        result = (
            result
            .ignore_special_periods()  # Bỏ qua các dấu chấm đặc biệt (viết tắt, số,...)
            .split_by_punctuation([('.', ' '), '。', '?', '？', '!', '!'])  # Tách theo dấu câu kết thúc
            .split_by_gap(0.8)  # Tách nếu khoảng cách giữa các từ quá lớn
            .split_by_length(100)  # Giới hạn độ dài tối đa của mỗi segment
        )
    
    return result

def extract_sentence_segments(result):
    """
    Trích xuất segments theo câu từ kết quả phiên âm.
    Mỗi segment là một câu hoàn chỉnh (tới dấu kết thúc câu).
    
    Args:
        result: Kết quả phiên âm (WhisperResult)
        
    Returns:
        list: Danh sách các segment theo câu hoàn chỉnh
    """
    sentence_segments = []
    
    for i, segment in enumerate(result.segments):
        # Loại bỏ các segment quá ngắn hoặc không có nội dung
        if not segment.text.strip() or len(segment.text.strip()) < 2:
            continue
            
        # Loại bỏ các khoảng trắng dư thừa ở đầu và cuối
        cleaned_text = segment.text.strip()
        
        # Xử lý tokens/words
        word_tokens = []
        if hasattr(segment, 'words') and segment.words:
            for word in segment.words:
                word_text = None
                # Ưu tiên sử dụng thuộc tính text nếu có
                if hasattr(word, 'text') and word.text:
                    word_text = word.text
                # Nếu không có text, thử dùng thuộc tính word
                elif hasattr(word, 'word') and word.word:
                    word_text = word.word
                
                if word_text:
                    word_tokens.append({
                        "text": word_text,
                        "start": word.start,
                        "end": word.end,
                        "probability": word.probability if hasattr(word, 'probability') else 1.0
                    })
        
        # Mỗi segment sẽ là một câu hoàn chỉnh với start/end time
        sentence_segments.append({
            "id": i,
            "start": segment.start,
            "end": segment.end,
            "text": cleaned_text,
            "word_count": len(cleaned_text.split()),
            "tokens": word_tokens
        })
    
    return sentence_segments

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000) 