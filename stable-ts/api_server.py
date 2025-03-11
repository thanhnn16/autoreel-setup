import os
import time
import uuid
import logging
import shutil
import torch
import subprocess
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
        # _model = stable_whisper.load_model("turbo", device=_device)
        _model = stable_whisper.load_model("large-v3", device=_device)
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
            "supported_audio": ["mp3", "wav", "m4a", "ogg", "flac", "mp4", "avi", "mkv"],
            "ass_features": {
                "rounded_corners": "Bo góc cho phụ đề ASS",
                "word_level": "Highlight từng từ khi phát âm",
                "karaoke": "Hiệu ứng karaoke"
            }
        },
        "version": "1.1.0"
    }

@app.post("/transcribe")
async def transcribe_audio(
    file: UploadFile = File(...),
    format: str = Form("txt"),
    use_cpu: bool = Form(False),
    segment_by_sentence: bool = Form(True),
    
    # Tham số cho ASS
    segment_level: bool = Form(True),
    word_level: bool = Form(True),
    min_dur: float = Form(0.2),
    font: str = Form("Noto Sans"),
    font_size: int = Form(14),
    strip: bool = Form(True),
    highlight_color: str = Form('05c2ed'),
    karaoke: bool = Form(False),
    reverse_text: bool = Form(False),
    rounded_corners: bool = Form(False),
    border_radius: int = Form(10),
    
    # Các tham số định dạng ASS
    background_color: str = Form('80000000'),
    primary_color: str = Form('FFFFFF'),
    secondary_color: str = Form('FFFFFF'),
    outline_color: str = Form('000000'),
    bold: bool = Form(False),
    italic: bool = Form(False),
    underline: bool = Form(False),
    strike_out: bool = Form(False),
    scale_x: int = Form(100),
    scale_y: int = Form(100),
    spacing: int = Form(0),
    angle: int = Form(0),
    border_style: int = Form(1),
    outline: int = Form(2),
    shadow: int = Form(2),
    alignment: int = Form(2),
    margin_l: int = Form(16),
    margin_r: int = Form(16),
    margin_v: int = Form(56),
    encoding: int = Form(163)
):
    """
    API endpoint để phiên âm file audio thành văn bản.
    
    Args:
        file (UploadFile): File audio cần phiên âm
        format (str): Định dạng đầu ra (txt, srt, vtt, ass, json, sentence)
        use_cpu (bool): Sử dụng CPU thay vì GPU
        segment_by_sentence (bool): Ngắt segment theo câu để có context tốt hơn
        
        # Tham số cho ASS
        segment_level (bool): Hiển thị phụ đề ở cấp độ đoạn
        word_level (bool): Hiển thị phụ đề ở cấp độ từng từ
        min_dur (float): Thời lượng tối thiểu cho mỗi từ/đoạn
        font (str): Tên font chữ
        font_size (int): Kích thước font
        strip (bool): Loại bỏ khoảng trắng thừa
        highlight_color (str): Màu highlight cho từng từ, định dạng BGR
        karaoke (bool): Tạo hiệu ứng karaoke
        reverse_text (bool): Đảo ngược thứ tự từ trong mỗi đoạn
        rounded_corners (bool): Áp dụng bo góc cho file ASS
        border_radius (int): Bán kính bo góc
        
        # Các tham số định dạng ASS
        background_color (str): Màu nền dạng AABBGGRR
        primary_color (str): Màu chữ chính
        secondary_color (str): Màu chữ phụ
        outline_color (str): Màu viền
        bold (bool): Chữ đậm
        italic (bool): Chữ nghiêng
        underline (bool): Chữ gạch chân
        strike_out (bool): Chữ gạch ngang
        scale_x (int): Tỷ lệ ngang của phụ đề
        scale_y (int): Tỷ lệ dọc của phụ đề
        spacing (int): Khoảng cách giữa các ký tự
        angle (int): Góc xoay của phụ đề
        border_style (int): Kiểu viền
        outline (int): Độ dày viền
        shadow (int): Độ đậm bóng
        alignment (int): Vị trí căn chỉnh phụ đề
        margin_l (int): Lề trái
        margin_r (int): Lề phải
        margin_v (int): Lề dọc
        encoding (int): Mã hóa ký tự
        
    Returns:
        Kết quả phiên âm theo định dạng yêu cầu
    """
    
    # Ghi log request
    logger.info(f"Nhận yêu cầu phiên âm file: {file.filename}, format: {format}, use_cpu: {use_cpu}, segment_by_sentence: {segment_by_sentence}")
    
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
            result, result_regrouped = process_audio_with_attention_mask(
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
        
        # Chọn phiên bản kết quả phù hợp cho format đầu ra và phản hồi
        # result: phiên bản không regroup (giữ nguyên segments gốc)
        # result_regrouped: phiên bản đã regroup theo câu (nếu segment_by_sentence=True)
        
        # Xử lý đặc biệt cho định dạng sentence
        if format == "sentence":
            # Trả về JSON trực tiếp với các segment câu, sử dụng phiên bản đã regroup nếu có
            display_result = result_regrouped if result_regrouped is not None else result
            sentence_segments = extract_sentence_segments(display_result)
            return JSONResponse(
                content={
                    "success": True,
                    "message": f"Đã phiên âm thành công file {file.filename}",
                    "processing_time": f"{process_time:.2f} giây",
                    "device": _device,
                    "text": display_result.text,
                    "segments": sentence_segments,
                    "segment_count": len(sentence_segments),
                    "segment_by_sentence": segment_by_sentence,
                    "regroup_history": display_result.regroup_history if hasattr(display_result, 'regroup_history') else ""
                }
            )
        
        # Tạo tên file đầu ra
        output_filename = f"{uuid.uuid4()}.{format}"
        output_path = OUTPUTS_DIR / output_filename
        
        logger.info(f"Tạo file đầu ra: {output_path} với định dạng {format}")
        
        # Quyết định dùng phiên bản kết quả nào dựa vào định dạng đầu ra
        # (giữ nguyên các segments gốc cho ASS, dùng phiên bản regroup cho các định dạng khác nếu có)
        output_result = result  # Mặc định dùng kết quả không regroup cho ASS
        if format != "ass" and result_regrouped is not None:  # Với các định dạng khác, dùng regroup nếu có
            output_result = result_regrouped
        
        # Lưu kết quả theo định dạng yêu cầu
        if format == "txt":
            with open(output_path, "w", encoding="utf-8") as f:
                f.write(output_result.text)
        elif format == "srt":
            output_result.to_srt_vtt(str(output_path))
        elif format == "vtt":
            output_result.to_srt_vtt(str(output_path), output_format="vtt")
        elif format == "ass":
            try:
                # Tạo từ điển kwargs cho các tham số định dạng ASS
                ass_style_kwargs = {
                    'Name': 'Default',
                    'Fontname': font,
                    'Fontsize': font_size,
                    'PrimaryColour': f"&H{primary_color}",
                    'SecondaryColour': f"&H{secondary_color}",
                    'OutlineColour': f"&H{outline_color}",
                    'BackColour': f"&H{background_color}",
                    'Bold': int(bold),
                    'Italic': int(italic),
                    'Underline': int(underline),
                    'StrikeOut': int(strike_out),
                    'ScaleX': scale_x,
                    'ScaleY': scale_y,
                    'Spacing': spacing,
                    'Angle': angle,
                    'BorderStyle': border_style,
                    'Outline': outline,
                    'Shadow': shadow,
                    'Alignment': alignment,
                    'MarginL': margin_l,
                    'MarginR': margin_r,
                    'MarginV': margin_v,
                    'Encoding': encoding
                }
                
                # Tạo file tạm để xử lý bo góc nếu cần
                temp_ass = None
                final_ass = output_path
                
                if rounded_corners:
                    # Nếu cần bo góc, tạo file tạm
                    temp_ass = TEMP_DIR / f"{uuid.uuid4()}.ass"
                    final_ass = output_path
                
                # Sử dụng phương thức to_ass với tất cả tham số, bỏ tham số tag
                result.to_ass(
                    str(temp_ass if rounded_corners else output_path),
                    segment_level=segment_level,
                    word_level=True,  # Đảm bảo word_level luôn được bật
                    min_dur=min_dur,
                    strip=strip,
                    highlight_color=highlight_color,
                    karaoke=karaoke,
                    reverse_text=reverse_text,
                    tag=-1,  # Thêm tham số tag=-1 để kích hoạt highlight cho từng từ riêng biệt
                    **ass_style_kwargs
                )
                
                # Áp dụng bo góc nếu được yêu cầu
                if rounded_corners:
                    logger.info(f"Áp dụng bo góc với bán kính {border_radius}")
                    try:
                        apply_rounded_borders(temp_ass, final_ass, border_radius)
                        # Xóa file tạm sau khi xử lý
                        temp_ass.unlink(missing_ok=True)
                    except Exception as e:
                        logger.error(f"Lỗi khi áp dụng bo góc: {str(e)}")
                        # Nếu có lỗi, sử dụng file gốc
                        shutil.copy(temp_ass, final_ass)
                        # Xóa file tạm
                        temp_ass.unlink(missing_ok=True)
                
            except AttributeError as e:
                if "'WordTiming' object has no attribute 'text'" in str(e):
                    logger.error(f"Lỗi khi xử lý: {str(e)}")
                    # Kiểm tra và đảm bảo mỗi từ có thuộc tính text
                    for segment in result.segments:
                        if hasattr(segment, 'words') and segment.words:
                            # Kiểm tra và chuyển đổi các words nếu không có thuộc tính text
                            for i, word in enumerate(segment.words):
                                if not hasattr(word, 'text') and hasattr(word, 'word'):
                                    # Sử dụng thuộc tính word nếu không có thuộc tính text
                                    word.text = word.word
                    
                    # Tạo file tạm để xử lý bo góc nếu cần
                    temp_ass = None
                    final_ass = output_path
                    
                    if rounded_corners:
                        # Nếu cần bo góc, tạo file tạm
                        temp_ass = TEMP_DIR / f"{uuid.uuid4()}.ass"
                        final_ass = output_path
                    
                    # Thử lại sau khi sửa với các tham số đã chỉ định
                    # Tạo từ điển kwargs cho các tham số định dạng ASS
                    ass_style_kwargs = {
                        'Name': 'Default',
                        'Fontname': font,
                        'Fontsize': font_size,
                        'PrimaryColour': f"&H{primary_color}",
                        'SecondaryColour': f"&H{secondary_color}",
                        'OutlineColour': f"&H{outline_color}",
                        'BackColour': f"&H{background_color}",
                        'Bold': int(bold),
                        'Italic': int(italic),
                        'Underline': int(underline),
                        'StrikeOut': int(strike_out),
                        'ScaleX': scale_x,
                        'ScaleY': scale_y,
                        'Spacing': spacing,
                        'Angle': angle,
                        'BorderStyle': border_style,
                        'Outline': outline,
                        'Shadow': shadow,
                        'Alignment': alignment,
                        'MarginL': margin_l,
                        'MarginR': margin_r,
                        'MarginV': margin_v,
                        'Encoding': encoding
                    }
                    
                    result.to_ass(
                        str(temp_ass if rounded_corners else output_path),
                        segment_level=segment_level,
                        word_level=True,  # Đảm bảo word_level luôn được bật
                        min_dur=min_dur,
                        strip=strip,
                        highlight_color=highlight_color,
                        karaoke=karaoke,
                        reverse_text=reverse_text,
                        tag=-1,  # Thêm tham số tag=-1 để kích hoạt highlight cho từng từ riêng biệt
                        **ass_style_kwargs
                    )
                    
                    # Áp dụng bo góc nếu được yêu cầu
                    if rounded_corners:
                        logger.info(f"Áp dụng bo góc với bán kính {border_radius}")
                        try:
                            apply_rounded_borders(temp_ass, final_ass, border_radius)
                            # Xóa file tạm sau khi xử lý
                            temp_ass.unlink(missing_ok=True)
                        except Exception as e:
                            logger.error(f"Lỗi khi áp dụng bo góc: {str(e)}")
                            # Nếu có lỗi, sử dụng file gốc
                            shutil.copy(temp_ass, final_ass)
                            # Xóa file tạm
                            temp_ass.unlink(missing_ok=True)
                else:
                    raise
        elif format == "json":
            with open(output_path, "w", encoding="utf-8") as f:
                import json
                json.dump(output_result.to_dict(), f, ensure_ascii=False, indent=2)
        
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
            "text": output_result.text  # Thêm nội dung text vào response cho tất cả các định dạng
        }
        
        # Với định dạng ASS, luôn trả về cả segments dạng câu (từ kết quả regroup) trong response
        if format == "ass" and result_regrouped is not None:
            sentence_segments = extract_sentence_segments(result_regrouped)
            response_content["segments"] = sentence_segments
        # Với các định dạng khác, trả về segments từ kết quả đã được sử dụng
        elif format == "ass":
            sentence_segments = extract_sentence_segments(result)  # Dùng segments gốc nếu không có regroup
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
        WhisperResult: Kết quả phiên âm gốc và kết quả đã gộp thành câu (nếu regroup=True)
    """
    # Thực hiện phiên âm với word_timestamps=True để có timestamps cho từng từ
    # Luôn thực hiện phiên âm với regroup=False để giữ nguyên segments gốc cho ASS
    result = model.transcribe(str(audio_path), language=language, regroup=False, word_timestamps=True)
    
    # Biến lưu kết quả đã regroup
    result_regrouped = None
    
    # Nếu bật regroup, thực hiện phiên âm lần hai với regroup=True hoặc 
    # áp dụng các phương thức regrouping lên kết quả
    if regroup:
        try:
            # Tạo kết quả regrouped bằng cách áp dụng các phương thức regrouping
            # Kết hợp các segments thành các câu hoàn chỉnh theo các dấu câu tiếng Việt
            # Các dấu câu kết thúc câu: dấu chấm, dấu chấm hỏi, dấu chấm than
            result_regrouped = (
                result
                .merge_all_segments()
                .ignore_special_periods()  # Bỏ qua các dấu chấm đặc biệt (viết tắt, số,...)
                .split_by_punctuation([('.', ' '), '。', '?', '？', '!', '!'])  # Tách theo dấu câu kết thúc
                .split_by_gap(0.8)  # Tách nếu khoảng cách giữa các từ quá lớn
                .split_by_length(100)  # Giới hạn độ dài tối đa của mỗi segment
            )
        except Exception as e:
            # Nếu có lỗi khi regrouping, ghi log và tiếp tục mà không có kết quả regrouped
            logger.warning(f"Không thể thực hiện regrouping: {str(e)}")
            result_regrouped = None
    
    # Trả về cả kết quả gốc (không regroup) và kết quả đã regroup
    return result, result_regrouped

def apply_rounded_borders(input_ass: Path, output_ass: Path, border_radius: int = 10):
    """
    Áp dụng bo góc cho file ASS sử dụng aegisub-cli
    
    Args:
        input_ass (Path): Đường dẫn file ASS đầu vào
        output_ass (Path): Đường dẫn file ASS đầu ra
        border_radius (int): Bán kính bo góc
    """
    try:
        # Tạo script automation tạm thời
        automation_dir = Path.home() / ".aegisub/automation/autoload"
        automation_dir.mkdir(parents=True, exist_ok=True)
        script_path = automation_dir / "rounded_borders.lua"
        
        # Nội dung script bo góc - đơn giản hóa script để tránh phụ thuộc vào DependencyControl và ILL
        script_content = """script_name = "Rounded Borders"
script_description = "Add rounded borders to subtitles"
script_author = "AutoReel"
script_version = "1.0"

function apply_rounded_borders(subtitles, selected_lines, active_line)
    local radius = BORDER_RADIUS_PLACEHOLDER
    
    -- Xử lý tất cả các dòng nếu không có dòng nào được chọn
    if #selected_lines == 0 then
        for i = 1, #subtitles do
            if subtitles[i].class == "dialogue" then
                table.insert(selected_lines, i)
            end
        end
    end
    
    -- Xử lý từng dòng được chọn
    local offset = 0
    for _, i in ipairs(selected_lines) do
        local line = subtitles[i + offset]
        
        -- Bỏ qua nếu không phải dòng dialogue
        if not line or line.class ~= "dialogue" then
            goto continue
        end
        
        -- Tạo dòng background
        local bg_line = {
            class = "dialogue",
            comment = false,
            layer = 0,
            start_time = line.start_time,
            end_time = line.end_time,
            style = line.style,
            actor = line.actor,
            margin_l = line.margin_l,
            margin_r = line.margin_r,
            margin_t = line.margin_t,
            margin_b = line.margin_b,
            effect = line.effect,
            text = string.format("{\\an7\\pos(0,0)\\bord0\\shad0\\1a&H80&\\c&H000000&\\p1}m 0 %d l %d 0 l 100 0 l 100 %d l %d 100 l 0 100 l 0 %d",
                radius, 100-radius, radius, radius, 100-radius)
        }
        
        -- Cập nhật dòng gốc
        line.layer = 1
        line.text = string.format("{\\an7\\pos(5,5)}%s", line.text:gsub("^{\\[^}]*}", ""))
        
        -- Cập nhật dòng gốc và thêm dòng background
        subtitles[i + offset] = line
        subtitles.insert(i + offset, bg_line)
        offset = offset + 1
        
        ::continue::
    end
    
    aegisub.set_undo_point("Rounded Borders")
end

aegisub.register_macro("Rounded Borders", "Apply rounded borders to subtitles", apply_rounded_borders)
"""
        # Thay thế placeholder bằng giá trị thực
        script_content = script_content.replace("BORDER_RADIUS_PLACEHOLDER", str(border_radius))
        
        # Ghi script vào file
        with open(script_path, "w", encoding="utf-8") as f:
            f.write(script_content)
        
        # Chạy aegisub-cli
        cmd = [
            "aegisub-cli",
            "--automation", str(script_path),
            str(input_ass),
            str(output_ass),
            "Rounded Borders/apply_rounded_borders"
        ]
        subprocess.run(cmd, check=True, capture_output=True)
        
    except Exception as e:
        logger.error(f"Lỗi khi áp dụng bo góc: {str(e)}")
        raise

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
            "text": cleaned_text
        })
    
    return sentence_segments

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000) 