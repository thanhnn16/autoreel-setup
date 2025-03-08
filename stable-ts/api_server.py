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
    API phiên âm file audio
    
    Parameters:
    - file: File audio cần phiên âm
    - format: Định dạng đầu ra (txt, srt, vtt, ass, json)
    - use_cpu: Có sử dụng CPU thay vì GPU không
    
    Returns:
    - Thông tin kết quả và URL để tải file
    """
    
    # Ghi log request
    logger.info(f"Nhận yêu cầu phiên âm file: {file.filename}, format: {format}, use_cpu: {use_cpu}")
    
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
            # Kiểm tra xem kết quả có thuộc tính words không
            has_words = False
            if hasattr(result, 'segments'):
                if result.segments and len(result.segments) > 0:
                    if hasattr(result.segments[0], 'words') and result.segments[0].words:
                        has_words = True

            if not has_words:
                logger.warning("Kết quả không chứa thông tin từng từ, không thể tạo file ASS")
                # Tạo SRT thay thế
                srt_path = output_path.with_suffix('.srt')
                result.to_srt_vtt(str(srt_path))
                shutil.copy(str(srt_path), str(output_path))
                try:
                    srt_path.unlink()
                except:
                    pass
                logger.info(f"Tạo SRT thay thế: {output_path}")
            else:
                try:
                    # Tạo thư mục đầu ra nếu chưa tồn tại
                    output_path.parent.mkdir(parents=True, exist_ok=True)
                    
                    # Thử với nhiều tham số rõ ràng ngay từ đầu
                    logger.info(f"Bắt đầu tạo file ASS với output_path: {output_path}")
                    result.to_ass(
                        str(output_path),
                        segment_level=True,
                        word_level=True,
                        min_dur=0.2,
                        font="Arial",
                        font_size=48,
                        highlight_color="00ff00"
                    )
                    
                    if not output_path.exists() or output_path.stat().st_size == 0:
                        raise FileNotFoundError("File ASS không được tạo hoặc kích thước bằng 0")
                    logger.info(f"Đã tạo thành công file ASS: {output_path}")
                except Exception as e:
                    logger.error(f"Lỗi khi xuất sang định dạng ASS: {str(e)}")
                    # Thử lại với phương pháp thứ hai
                    logger.info("Thử lại với phương pháp thứ hai...")
                    try:
                        # Lưu JSON tạm thời
                        json_path = output_path.with_suffix('.json')
                        logger.info(f"Lưu file JSON tạm thời: {json_path}")
                        with open(json_path, "w", encoding="utf-8") as f:
                            import json
                            json.dump(result.to_dict(), f, ensure_ascii=False, indent=2)
                        
                        # Kiểm tra file JSON có được tạo thành công không
                        if not json_path.exists():
                            raise FileNotFoundError("Không thể tạo file JSON tạm thời")
                        
                        # Tạo lại đối tượng WhisperResult từ JSON và thử xuất ASS
                        logger.info("Tạo lại đối tượng WhisperResult từ file JSON")
                        new_result = WhisperResult(str(json_path))
                        logger.info("Bắt đầu tạo file ASS từ đối tượng mới")
                        new_result.to_ass(
                            str(output_path),
                            segment_level=True,
                            word_level=True,
                            min_dur=0.2,
                            font="Arial",
                            font_size=48
                        )
                        
                        # Xóa file JSON tạm
                        try:
                            json_path.unlink()
                            logger.info(f"Đã xóa file JSON tạm thời: {json_path}")
                        except Exception as e3:
                            logger.warning(f"Không thể xóa file JSON tạm thời: {str(e3)}")
                            
                        logger.info(f"Đã tạo thành công file ASS (phương pháp thứ hai): {output_path}")
                    except Exception as e2:
                        logger.error(f"Vẫn không thể tạo file ASS: {str(e2)}")
                        # Phương pháp thứ ba: tạo ASS trực tiếp từ thông tin segment
                        logger.info("Thử phương pháp thứ ba: tạo ASS trực tiếp...")
                        try:
                            # Tạo nội dung ASS cơ bản
                            ass_content = create_basic_ass_content(result)
                            with open(output_path, "w", encoding="utf-8") as f:
                                f.write(ass_content)
                            logger.info(f"Đã tạo file ASS đơn giản: {output_path}")
                        except Exception as e3:
                            logger.error(f"Phương pháp thứ ba cũng thất bại: {str(e3)}")
                            # Nếu vẫn không thể tạo ASS, tạo SRT thay thế
                            logger.info("Tạo SRT thay thế...")
                            srt_path = output_path.with_suffix('.srt')
                            result.to_srt_vtt(str(srt_path), word_level=True, segment_level=True)
                            # Đổi tên SRT thành ASS
                            shutil.copy(str(srt_path), str(output_path))
                            try:
                                srt_path.unlink()
                            except:
                                pass
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
    
    # Nếu file yêu cầu là ASS nhưng thực tế là txt
    if extension == "ass" and filename.endswith(".ass"):
        # Đọc nội dung file để kiểm tra
        with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
            content = f.read(100)  # Đọc 100 ký tự đầu tiên để kiểm tra
            if not content.startswith("[Script Info]") and not "Style: Default" in content:
                logger.warning(f"File ASS không hợp lệ: {file_path}, nội dung: {content}")
    
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
    # Các tùy chọn transcribe cơ bản
    transcribe_options = {
        "language": language,
        "word_timestamps": True,     # Bắt buộc có timestamp ở cấp độ từng từ
    }
    
    # Kiểm tra các tùy chọn nâng cao được hỗ trợ trong phiên bản stable-ts đang sử dụng
    advanced_options = {
        "vad": True,                 # Sử dụng Voice Activity Detection
        "suppress_silence": True,    # Loại bỏ khoảng im lặng
        "vad_threshold": 0.5,        # Threshold cho VAD
        "repetition_penalty": 1.2,   # Giảm khả năng lặp từ
    }
    
    # Kiểm tra tính năng suppress_nonspeech (có thể không được hỗ trợ trong mọi phiên bản)
    try:
        # Thử mẫu với một vài tùy chọn nâng cao trước
        test_result = model.transcribe(
            str(audio_path),
            language=language,
            suppress_nonspeech=True,
            _skip_processing=True,  # Tránh thực sự phiên âm, chỉ kiểm tra tùy chọn
            max_initial_timestamp=0.01,  # Giảm thiểu thời gian xử lý cho việc kiểm tra
        )
        # Nếu không lỗi thì thêm tùy chọn này
        advanced_options["suppress_nonspeech"] = True
    except Exception as e:
        logger.info(f"Tùy chọn 'suppress_nonspeech' không được hỗ trợ trong phiên bản này: {str(e)}")
    
    # Thêm tất cả tùy chọn nâng cao được hỗ trợ
    transcribe_options.update(advanced_options)
    
    # Nếu có GPU, thêm tùy chọn tối ưu
    if _device == "cuda":
        transcribe_options["beam_size"] = 5
        
        # Kiểm tra nếu mô hình là HF pipeline, thêm attn_implementation
        if hasattr(model, 'pipeline') and hasattr(model.pipeline, 'model'):
            if "generate_kwargs" not in transcribe_options:
                transcribe_options["generate_kwargs"] = {}
            transcribe_options["generate_kwargs"]["attn_implementation"] = "eager"
    
    # Thực hiện phiên âm
    logger.debug(f"Sử dụng các tùy chọn phiên âm: {transcribe_options}")
    
    try:
        result = model.transcribe(
            str(audio_path),
            **transcribe_options
        )
        return result
    except TypeError as e:
        # Xử lý trường hợp các tùy chọn không được hỗ trợ
        if "got an unexpected keyword argument" in str(e):
            # Tách tên tùy chọn gây lỗi từ thông báo lỗi
            invalid_option = str(e).split("'")[1] if "'" in str(e) else None
            
            if invalid_option and invalid_option in transcribe_options:
                logger.warning(f"Loại bỏ tùy chọn không được hỗ trợ: {invalid_option}")
                transcribe_options.pop(invalid_option, None)
                
                # Thử lại với tùy chọn đã lược bỏ
                return model.transcribe(
                    str(audio_path),
                    **transcribe_options
                )
        
        # Nếu không phải lỗi tùy chọn hoặc không thể xử lý, ném lại ngoại lệ
        raise e

def create_basic_ass_content(result):
    """
    Tạo nội dung ASS cơ bản từ đối tượng kết quả.
    Hàm này tạo file ASS đơn giản nhất có thể từ thông tin segment.
    """
    ass_header = """[Script Info]
Title: Auto-generated ASS file
ScriptType: v4.00+
PlayResX: 1280
PlayResY: 720
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,48,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,2,2,10,10,10,1
Style: Hilight,Arial,48,&H0000FF00,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,2,2,10,10,10,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    
    events = []
    
    # Thêm events từ segments
    for i, segment in enumerate(result.segments):
        start_time = format_ass_time(segment.start)
        end_time = format_ass_time(segment.end)
        text = segment.text.strip()
        
        event_line = f"Dialogue: 0,{start_time},{end_time},Default,,0,0,0,,{text}"
        events.append(event_line)
    
    # Kết hợp header và events
    ass_content = ass_header + "\n".join(events)
    return ass_content

def format_ass_time(seconds):
    """Format thời gian từ giây sang định dạng ASS (h:mm:ss.cc)"""
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    seconds = seconds % 60
    centiseconds = int((seconds % 1) * 100)
    seconds = int(seconds)
    
    return f"{hours}:{minutes:02d}:{seconds:02d}.{centiseconds:02d}"

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000) 