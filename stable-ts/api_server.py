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
        # _model = stable_whisper.load_model("large-v3", device=_device)
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
            "/transcribe": "POST - Phiên âm file âm thanh sang ASS subtitle",
            "/download/{filename}": "GET - Tải file kết quả"
        },
        "features": {
            "rounded_corners": "Bo góc cho phụ đề ASS",
            "word_level": "Highlight từng từ khi phát âm",
            "max_lines": "Giới hạn 2 dòng subtitle",
            "supported_audio": ["mp3", "wav", "m4a", "ogg", "flac", "mp4", "avi", "mkv"]
        },
        "version": "1.1.0"
    }

@app.post("/transcribe")
async def transcribe_audio(
    file: UploadFile = File(...),
    use_cpu: bool = Form(False),
    
    # Tham số cho ASS
    font: str = Form("Montserrat"),
    font_size: int = Form(80),  # Tăng font size từ 72 lên 80 cho video dọc
    highlight_color: str = Form('EDA005'),
    border_radius: int = Form(24),
    
    # Các tham số định dạng ASS
    background_color: str = Form('80000000'),
    primary_color: str = Form('EDA005'),
    outline_color: str = Form('000000'),
    outline: int = Form(3),  # Tăng độ dày viền từ 2 lên 3
    shadow: int = Form(3),   # Tăng độ đậm bóng từ 2 lên 3
    alignment: int = Form(2),
    margin_l: int = Form(20),  # Tăng lề trái từ 16 lên 20
    margin_r: int = Form(20),  # Tăng lề phải từ 16 lên 20
    margin_v: int = Form(80),  # Tăng lề dọc từ 56 lên 80
    encoding: int = Form(163)
):
    """
    API endpoint để phiên âm file audio thành ASS subtitle.
    
    Args:
        file (UploadFile): File audio cần phiên âm
        use_cpu (bool): Sử dụng CPU thay vì GPU
        
        # Tham số cho ASS
        font (str): Tên font chữ
        font_size (int): Kích thước font
        highlight_color (str): Màu highlight cho từng từ, định dạng BGR
        border_radius (int): Bán kính bo góc
        
        # Các tham số định dạng ASS
        background_color (str): Màu nền dạng AABBGGRR
        primary_color (str): Màu chữ chính
        outline_color (str): Màu viền
        outline (int): Độ dày viền
        shadow (int): Độ đậm bóng
        alignment (int): Vị trí căn chỉnh phụ đề
        margin_l (int): Lề trái
        margin_r (int): Lề phải
        margin_v (int): Lề dọc
        encoding (int): Mã hóa ký tự
        
    Returns:
        Kết quả phiên âm dưới dạng ASS subtitle
    """
    
    # Ghi log request
    logger.info(f"Nhận yêu cầu phiên âm file: {file.filename}, use_cpu: {use_cpu}")
    
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
            result = process_audio_with_attention_mask(model, temp_file, language="vi")
        except Exception as e:
            logger.error(f"Không thể phiên âm: {str(e)}")
            raise
        
        process_time = time.time() - start_time
        logger.info(f"Thời gian xử lý: {process_time:.2f} giây, với thiết bị: {_device}")
        
        # Tạo tên file đầu ra
        output_filename = f"{uuid.uuid4()}.ass"
        output_path = OUTPUTS_DIR / output_filename
        
        logger.info(f"Tạo file ASS: {output_path}")
        
        # Tạo file tạm để xử lý bo góc
        temp_ass = TEMP_DIR / f"{uuid.uuid4()}.ass"
        
        # Tạo từ điển kwargs cho các tham số định dạng ASS
        ass_style_kwargs = {
            'Name': 'Default',
            'Fontname': font,
            'Fontsize': font_size,
            'PrimaryColour': f"&H00{primary_color}",
            'OutlineColour': f"&H00{outline_color}",
            'BackColour': f"&H{background_color}",
            'Bold': 0,
            'Italic': 0,
            'Underline': 0,
            'StrikeOut': 0,
            'ScaleX': 100,
            'ScaleY': 100,
            'Spacing': 0,
            'Angle': 0,
            'BorderStyle': 1,
            'Outline': outline,
            'Shadow': shadow,
            'Alignment': alignment,
            'MarginL': margin_l,
            'MarginR': margin_r,
            'MarginV': margin_v,
            'Encoding': encoding
        }
        
        # Tạo ASS subtitle với word-level timing
        logger.info(f"Tạo file ASS với highlight_color: {highlight_color}, font_size: {font_size}")
        
        # Chuyển đổi highlight_color từ định dạng RGB sang BGR (ASS sử dụng BGR)
        highlight_color_bgr = highlight_color
        if len(highlight_color) == 6:
            # Nếu highlight_color là RGB, chuyển sang BGR
            r, g, b = highlight_color[:2], highlight_color[2:4], highlight_color[4:]
            highlight_color_bgr = b + g + r
            logger.info(f"Đã chuyển đổi highlight_color từ RGB {highlight_color} sang BGR {highlight_color_bgr}")
        
        result.to_ass(
            str(temp_ass),
            highlight_color=highlight_color_bgr,
            **ass_style_kwargs
        )
        
        # Sửa lại file ASS để đảm bảo font size và highlight color được áp dụng đúng
        try:
            with open(temp_ass, 'r', encoding='utf-8') as f:
                ass_content = f.readlines()
            
            # Tìm và sửa style Default
            for i, line in enumerate(ass_content):
                if line.startswith("Style: Default,"):
                    parts = line.split(',')
                    if len(parts) > 2:
                        # Đảm bảo font size đúng
                        original_font_size = parts[2]
                        parts[2] = str(font_size)
                        logger.info(f"Đã thay đổi font size từ {original_font_size} thành {font_size} trong style Default")
                    ass_content[i] = ','.join(parts)
            
            # Kiểm tra và thêm highlight color vào các dòng Dialogue
            highlight_found = False
            for i, line in enumerate(ass_content):
                if line.startswith("Dialogue:") and "\\1c&H" in line:
                    highlight_found = True
                    logger.info(f"Đã tìm thấy highlight color trong dòng: {line.strip()}")
                    break
            
            if not highlight_found:
                logger.warning(f"Không tìm thấy highlight color trong file ASS. Highlight color đã cài đặt: {highlight_color}")
                
                # Thêm highlight color vào các dòng Dialogue
                for i, line in enumerate(ass_content):
                    if line.startswith("Dialogue:") and "Default" in line and "{\\k" in line:
                        # Tìm vị trí của tag karaoke đầu tiên
                        parts = line.split(',', 9)
                        if len(parts) >= 10:
                            text = parts[9]
                            # Thêm tag highlight color vào mỗi tag karaoke
                            modified_text = text.replace("{\\k", "{\\1c&H" + highlight_color_bgr + "&\\k")
                            # Cập nhật dòng với highlight color
                            parts[9] = modified_text
                            ass_content[i] = ','.join(parts)
                            logger.info(f"Đã thêm highlight color vào dòng: {i+1}")
            
            # Ghi lại file
            with open(temp_ass, 'w', encoding='utf-8') as f:
                f.writelines(ass_content)
            
            logger.info(f"Đã sửa lại file ASS để đảm bảo font size: {font_size} và highlight color: {highlight_color}")
        except Exception as e:
            logger.error(f"Lỗi khi sửa lại file ASS: {str(e)}")
        
        # Log 15 dòng đầu của file ASS trước khi áp dụng bo góc
        logger.info("=== 15 dòng đầu của file ASS TRƯỚC KHI áp dụng bo góc ===")
        try:
            with open(temp_ass, 'r', encoding='utf-8') as f:
                first_15_lines = [next(f) for _ in range(15)]
                for i, line in enumerate(first_15_lines):
                    logger.info(f"Dòng {i+1}: {line.strip()}")
                
                # Tìm và log một số dòng Dialogue
                logger.info("=== Một số dòng Dialogue TRƯỚC KHI áp dụng bo góc ===")
                dialogue_count = 0
                # Đặt lại con trỏ file về đầu
                f.seek(0)
                for line in f:
                    if line.startswith("Dialogue:"):
                        logger.info(f"Dialogue: {line.strip()}")
                        dialogue_count += 1
                        if dialogue_count >= 5:  # Chỉ log 5 dòng Dialogue đầu tiên
                            break
        except Exception as e:
            logger.error(f"Lỗi khi đọc file ASS ban đầu: {str(e)}")
        
        # Áp dụng bo góc
        logger.info(f"Áp dụng bo góc với bán kính {border_radius}")
        try:
            apply_rounded_borders(temp_ass, output_path, border_radius)
            
            # Log 15 dòng đầu của file ASS sau khi áp dụng bo góc
            logger.info("=== 15 dòng đầu của file ASS SAU KHI áp dụng bo góc ===")
            try:
                with open(output_path, 'r', encoding='utf-8') as f:
                    first_15_lines = [next(f) for _ in range(15)]
                    for i, line in enumerate(first_15_lines):
                        logger.info(f"Dòng {i+1}: {line.strip()}")
                    
                    # Tìm và log một số dòng Dialogue
                    logger.info("=== Một số dòng Dialogue SAU KHI áp dụng bo góc ===")
                    dialogue_count = 0
                    # Đặt lại con trỏ file về đầu
                    f.seek(0)
                    for line in f:
                        if line.startswith("Dialogue:"):
                            logger.info(f"Dialogue: {line.strip()}")
                            dialogue_count += 1
                            if dialogue_count >= 10:  # Log 10 dòng Dialogue đầu tiên (bao gồm cả background)
                                break
            except Exception as e:
                logger.error(f"Lỗi khi đọc file ASS sau khi áp dụng bo góc: {str(e)}")
            
            # Xóa file tạm sau khi xử lý
            temp_ass.unlink(missing_ok=True)
        except Exception as e:
            logger.error(f"Lỗi khi áp dụng bo góc: {str(e)}")
            # Nếu có lỗi, sử dụng file gốc
            shutil.copy(temp_ass, output_path)
            # Xóa file tạm
            temp_ass.unlink(missing_ok=True)
        
        # Xóa file tạm
        try:
            temp_file.unlink()
        except Exception as e:
            logger.warning(f"Không thể xóa file tạm {temp_file}: {str(e)}")
        
        # Trả về URL để tải file kết quả
        download_url = f"/download/{output_filename}"
        
        logger.info(f"Hoàn thành phiên âm. URL tải xuống: {download_url}")
        
        # Trích xuất segments để trả về trong response
        sentence_segments = extract_sentence_segments(result)
        
        return JSONResponse(
            content={
                "success": True,
                "message": f"Đã phiên âm thành công file {file.filename}",
                "processing_time": f"{process_time:.2f} giây",
                "device": _device,
                "download_url": download_url,
                "text": result.text,
                "segments": sentence_segments
            }
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
            return await transcribe_audio(file, use_cpu=True)
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
    
    return FileResponse(
        path=file_path,
        media_type="text/plain",
        filename=filename
    )

def process_audio_with_attention_mask(model, audio_path, language="vi"):
    """
    Xử lý audio với transcribe mặc định và tối ưu cho phụ đề 2 dòng.
    
    Args:
        model: Mô hình stable-ts đã tải
        audio_path: Đường dẫn đến file audio
        language: Ngôn ngữ (mặc định là "vi")
        
    Returns:
        WhisperResult: Kết quả phiên âm đã được tối ưu
    """
    # Sử dụng transcribe với các tùy chọn tối ưu cho phụ đề
    result = model.transcribe(
        str(audio_path), 
        language=language,
        regroup=True,  # Bật tính năng regroup mặc định
        word_timestamps=True,  # Bật timestamps ở cấp độ từ
        vad=True,      # Sử dụng VAD để phát hiện giọng nói chính xác hơn
    )
    
    # Tối ưu thêm kết quả với các phương pháp chaining
    # Tối ưu cho video 1080x1920 với font Montserrat kích thước 80
    # Giới hạn 2 dòng cho phụ đề
    (
        result
        .ignore_special_periods()  # Bỏ qua các dấu chấm đặc biệt
        .clamp_max()               # Giới hạn thời gian tối đa
        # Ngắt theo dấu câu tiếng Việt
        .split_by_punctuation([('.', ' '), '。', '?', '？', '!', '！'])
        .split_by_gap(0.5)         # Ngắt khi có khoảng trống > 0.5s
        .split_by_punctuation([(',', ' '), '，', ';', '；'], min_chars=40)
        .split_by_length(60)       # Ngắt khi dòng quá dài để phù hợp với font size 80
        .clamp_max()               # Giới hạn lại thời gian tối đa
    )
    
    logger.info(f"Đã tối ưu kết quả phiên âm với regroup và ngắt theo dấu câu")
    
    return result

def apply_rounded_borders(input_ass: Path, output_ass: Path, border_radius: int = 10):
    """
    Áp dụng bo góc cho file ASS và đảm bảo giữ nguyên hiệu ứng highlight từng từ
    Tối ưu cho video kích thước 1080x1920 (chiều rộng x chiều cao)
    Xử lý tốt các trường hợp text 1 dòng, 2 dòng, text ngắn và dài
    Đảm bảo layer của dialogue luôn là 1 và layer của background luôn là 0
    """
    try:
        # Thiết lập các tham số mặc định (tương tự như trong test_ass.ps1)
        padding_h_factor = 0.1     # Hệ số padding ngang
        padding_v_factor = 0.2     # Hệ số padding dọc
        char_width_factor = 0.5    # Hệ số chiều rộng ký tự
        line_height_factor = 1.6   # Hệ số chiều cao dòng
        min_width_factor = 1.2     # Hệ số chiều rộng tối thiểu
        max_width_factor = 0.95    # Hệ số chiều rộng tối đa
        min_height_factor = 0.8    # Hệ số chiều cao tối thiểu
        corner_radius_factor = 0.15 # Hệ số bán kính bo góc
        background_opacity = 0.6    # Độ mờ của background (0-1)
        background_color = "303030" # Màu nền (RGB)

        # Đọc nội dung file ASS đầu vào
        with open(input_ass, 'r', encoding='utf-8') as f:
            lines = f.readlines()

        # Khởi tạo các đối tượng để lưu trữ dữ liệu từ file ASS
        script_info = {}  # Lưu thông tin chung của script
        styles = {}      # Lưu các style được định nghĩa
        events = []      # Lưu các sự kiện (dialogue)
        current_section = None  # Theo dõi section hiện tại đang phân tích

        # Kiểm tra highlight color trong các dòng Dialogue
        highlight_found = False
        for line in lines:
            if line.startswith("Dialogue:") and "\\1c&H" in line:
                highlight_found = True
                logger.info(f"Đã tìm thấy highlight color trong dòng trước khi áp dụng bo góc: {line.strip()}")
                break
        
        if not highlight_found:
            logger.warning("Không tìm thấy highlight color trong file ASS trước khi áp dụng bo góc")

        # Phân tích file ASS để lấy thông tin
        for line in lines:
            # Xác định section hiện tại
            if line.strip() == "[Script Info]":
                current_section = "ScriptInfo"
                continue
            elif line.strip() == "[V4+ Styles]":
                current_section = "Styles"
                continue
            elif line.strip() == "[Events]":
                current_section = "Events"
                continue
            
            # Xử lý dữ liệu dựa trên section hiện tại
            if current_section == "ScriptInfo":
                # Lưu thông tin script (ví dụ: PlayResX, PlayResY, v.v.)
                if line.strip() and ':' in line:
                    key, value = line.split(':', 1)
                    script_info[key.strip()] = value.strip()
            elif current_section == "Styles" and line.startswith("Style:"):
                # Phân tích và lưu thông tin style
                style_data = line[6:].strip().split(',')
                if len(style_data) >= 22:  # Đảm bảo đủ trường dữ liệu
                    style_name = style_data[0]
                    styles[style_name] = {
                        'Name': style_name,
                        'Fontname': style_data[1],
                        'Fontsize': int(style_data[2]) if style_data[2].isdigit() else 80,
                        'PrimaryColour': style_data[3],
                        'SecondaryColour': style_data[4],
                        'OutlineColour': style_data[5],
                        'BackColour': style_data[6],
                        'Bold': style_data[7],
                        'Italic': style_data[8],
                        'Underline': style_data[9],
                        'StrikeOut': style_data[10],
                        'ScaleX': float(style_data[11]) if style_data[11].replace('.', '', 1).isdigit() else 100,
                        'ScaleY': float(style_data[12]) if style_data[12].replace('.', '', 1).isdigit() else 100,
                        'Spacing': float(style_data[13]) if style_data[13].replace('.', '', 1).isdigit() else 0,
                        'Angle': style_data[14],
                        'BorderStyle': style_data[15],
                        'Outline': style_data[16],
                        'Shadow': style_data[17],
                        'Alignment': int(style_data[18]) if style_data[18].isdigit() else 2,
                        'MarginL': int(style_data[19]) if style_data[19].isdigit() else 20,
                        'MarginR': int(style_data[20]) if style_data[20].isdigit() else 20,
                        'MarginV': int(style_data[21]) if style_data[21].isdigit() else 80,
                        'Encoding': style_data[22] if len(style_data) > 22 else "1"
                    }
            elif current_section == "Events" and line.startswith("Dialogue:"):
                # Phân tích và lưu thông tin dialogue
                dialogue_data = line[9:].strip().split(',', 9)  # Tách tối đa 10 phần
                if len(dialogue_data) >= 10:
                    events.append({
                        'Layer': dialogue_data[0],
                        'Start': dialogue_data[1],
                        'End': dialogue_data[2],
                        'Style': dialogue_data[3],
                        'Name': dialogue_data[4],
                        'MarginL': dialogue_data[5],
                        'MarginR': dialogue_data[6],
                        'MarginV': dialogue_data[7],
                        'Effect': dialogue_data[8],
                        'Text': dialogue_data[9]
                    })

        # Lấy thông tin kích thước video từ ScriptInfo
        video_width = 1080  # Giá trị mặc định
        video_height = 1920 # Giá trị mặc định

        if "PlayResX" in script_info:
            video_width = int(script_info["PlayResX"])
        if "PlayResY" in script_info:
            video_height = int(script_info["PlayResY"])

        logger.info(f"Kích thước video: {video_width} x {video_height}")

        # Lấy thông tin style mặc định để sử dụng cho các phép tính
        default_style = None
        if "Default" in styles:
            default_style = styles["Default"]
        else:
            # Nếu không có style Default, lấy style đầu tiên
            if styles:
                default_style = list(styles.values())[0]
            else:
                # Tạo style mặc định nếu không có style nào
                default_style = {
                    'Name': 'Default',
                    'Fontname': 'Montserrat',
                    'Fontsize': 80,
                    'PrimaryColour': '&H00FFFFFF',
                    'SecondaryColour': '&H000000FF',
                    'OutlineColour': '&H00000000',
                    'BackColour': '&H80000000',
                    'Bold': '0',
                    'Italic': '0',
                    'Underline': '0',
                    'StrikeOut': '0',
                    'ScaleX': 100.0,
                    'ScaleY': 100.0,
                    'Spacing': 0.0,
                    'Angle': '0',
                    'BorderStyle': '1',
                    'Outline': '3',
                    'Shadow': '3',
                    'Alignment': 2,
                    'MarginL': 20,
                    'MarginR': 20,
                    'MarginV': 80,
                    'Encoding': '163'
                }
                styles['Default'] = default_style

        # Lưu các thuộc tính style quan trọng để sử dụng sau
        font_size = default_style['Fontsize']
        margin_v = default_style['MarginV']
        alignment = default_style['Alignment']
        scale_x = default_style['ScaleX'] / 100.0  # Chuyển đổi từ phần trăm sang hệ số
        scale_y = default_style['ScaleY'] / 100.0  # Chuyển đổi từ phần trăm sang hệ số
        spacing = default_style['Spacing']

        logger.info(f"Font size: {font_size}, MarginV: {margin_v}, Alignment: {alignment}, ScaleX: {scale_x}, ScaleY: {scale_y}, Spacing: {spacing}")

        # Tạo header cho file ASS mới
        new_ass_content = [
            "[Script Info]\n",
            f"PlayResX: {video_width}\n",
            f"PlayResY: {video_height}\n",
            "ScriptType: v4.00+\n",
            "Title: ASS with Rounded Corners\n",
            "ScaledBorderAndShadow: yes\n",
            "\n",
            "[V4+ Styles]\n",
            "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n"
        ]

        # Hàm tiện ích để tính chiều rộng của văn bản
        def calculate_text_width(text, font_size, scale_x, spacing, char_width_factor):
            # Tính toán chiều rộng dựa trên số ký tự, font size, scale và spacing
            base_width = len(text) * (font_size * char_width_factor * scale_x)
            spacing_width = (len(text) - 1) * spacing  # Spacing giữa các ký tự
            return base_width + spacing_width

        # Hàm tiện ích để tính chiều cao của văn bản
        def calculate_text_height(num_lines, font_size, scale_y, line_height_factor):
            # Tính chiều cao mỗi dòng là fontsize * scaleY
            # lineHeightFactor dùng để điều chỉnh khoảng cách giữa các dòng
            base_height = (font_size * scale_y * num_lines) + ((num_lines - 1) * font_size * scale_y * (line_height_factor - 1))
            
            # Giảm 10% chiều cao nếu có 2 dòng để tối ưu hiển thị
            if num_lines == 2:
                base_height = base_height * 0.9
                
            return base_height

        # Hàm tiện ích để ước tính số dòng thực tế
        def get_actual_lines(text, font_size, scale_x, char_width_factor, max_width):
            import re
            # Loại bỏ các tag ASS như {\\k10}, {\\1c&HEDC205&\\k10}, v.v.
            clean_text = re.sub(r'\{\\[^}]*\}', '', text)
            
            # Tách văn bản thành các từ
            words = clean_text.split()
            current_line_length = 0
            lines = 1
            
            # Duyệt qua từng từ và tính toán số dòng cần thiết
            for word in words:
                word_length = len(word) * (font_size * char_width_factor * scale_x)
                
                # Nếu thêm từ này vượt quá độ rộng tối đa, xuống dòng mới
                if (current_line_length + word_length) > max_width:
                    lines += 1
                    current_line_length = word_length
                else:
                    current_line_length += word_length + (font_size * char_width_factor * scale_x)  # Thêm khoảng trắng
                    
            return lines

        # Hàm tiện ích để tạo đường viền bo góc
        def create_rounded_rectangle_drawing(width, height, radius, scale=1):
            # Chia tỷ lệ theo scale
            scaled_width = width / scale
            scaled_height = height / scale
            scaled_radius = radius / scale
            
            # Tạo drawing command với điểm gốc (0,0) và đường cong Bezier cho các góc
            drawing = f"m {scaled_radius} 0 " + \
                    f"l {scaled_width - scaled_radius} 0 " + \
                    f"b {scaled_width - scaled_radius/2} 0 {scaled_width} {scaled_radius/2} {scaled_width} {scaled_radius} " + \
                    f"l {scaled_width} {scaled_height - scaled_radius} " + \
                    f"b {scaled_width} {scaled_height - scaled_radius/2} {scaled_width - scaled_radius/2} {scaled_height} {scaled_width - scaled_radius} {scaled_height} " + \
                    f"l {scaled_radius} {scaled_height} " + \
                    f"b {scaled_radius/2} {scaled_height} 0 {scaled_height - scaled_radius/2} 0 {scaled_height - scaled_radius} " + \
                    f"l 0 {scaled_radius} " + \
                    f"b 0 {scaled_radius/2} {scaled_radius/2} 0 {scaled_radius} 0"
            
            return drawing

        # Thêm các style từ file gốc vào file mới (để giữ các style đã có)
        for style in styles.values():
            style_str = f"Style: {style['Name']},{style['Fontname']},{style['Fontsize']},{style['PrimaryColour']},{style['SecondaryColour']},{style['OutlineColour']},{style['BackColour']},{style['Bold']},{style['Italic']},{style['Underline']},{style['StrikeOut']},{style['ScaleX']},{style['ScaleY']},{style['Spacing']},{style['Angle']},{style['BorderStyle']},{style['Outline']},{style['Shadow']},{style['Alignment']},{style['MarginL']},{style['MarginR']},{style['MarginV']},{style['Encoding']}\n"
            new_ass_content.append(style_str)

        # Tính toán giá trị alpha cho background (0-255, trong đó 0 là hoàn toàn trong suốt, 255 là đục hoàn toàn)
        alpha = int(255 * (1 - background_opacity))
        alpha_hex = format(alpha, '02X').upper()  # Chuyển đổi sang hex và đảm bảo 2 ký tự

        # Thêm style Background nếu chưa có
        if not any(style['Name'] == 'Background' for style in styles.values()):
            new_ass_content.append(f"Style: Background,Arial,{font_size},&H{alpha_hex}{background_color},&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,0,0,0,{alignment},{default_style['MarginL']},{default_style['MarginR']},{margin_v},1\n")

        # Thêm phần Events header
        new_ass_content.append("\n[Events]\n")
        new_ass_content.append("Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n")

        # Tạo danh sách các events mới (bao gồm background và dialogue)
        new_events = []

        # Xử lý từng dialogue và tạo background tương ứng
        for event in events:
            # Bỏ qua nếu đã là background
            if event['Style'] == "Background":
                continue
            
            # Lấy style tương ứng với dialogue
            style = default_style
            if event['Style'] in styles:
                style = styles[event['Style']]
            
            # Lấy các thuộc tính font và style
            font_size = style['Fontsize']
            alignment = style['Alignment']
            scale_x = style['ScaleX'] / 100.0
            scale_y = style['ScaleY'] / 100.0
            spacing = style['Spacing']
            
            # Lấy text từ dialogue và loại bỏ các tag ASS
            text = event['Text']
            import re
            clean_text = re.sub(r'\{\\[^}]*\}', '', text)
            
            # Tính toán số dòng thực tế và chiều rộng tối đa
            max_line_width = video_width * max_width_factor
            num_lines = get_actual_lines(clean_text, font_size, scale_x, char_width_factor, max_line_width)
            
            # Tính toán padding dựa trên kích thước font
            padding_h = int(font_size * padding_h_factor)
            padding_v = int(font_size * padding_v_factor)
            
            # Giảm padding dọc thêm 10% nếu có 2 dòng để tối ưu hiển thị
            if num_lines == 2:
                padding_v = int(padding_v * 0.9)
            
            # Tính chiều rộng văn bản
            text_width = calculate_text_width(clean_text, font_size, scale_x, spacing, char_width_factor)
            
            # Tính chiều rộng nền với giới hạn min/max
            calculated_width = int(text_width) + (padding_h * 2)
            min_width = font_size * min_width_factor  # Đảm bảo nền không quá nhỏ
            max_width = int(video_width * max_width_factor)  # Đảm bảo nền không vượt quá % màn hình
            bg_width = min(max(calculated_width, min_width), max_width)
            
            # Tính chiều cao văn bản
            text_height = calculate_text_height(num_lines, font_size, scale_y, line_height_factor)
            
            # Tính chiều cao nền với điều chỉnh cho số dòng
            bg_height = int(text_height) + (padding_v * 2)
            
            # Giảm thêm 10% chiều cao nếu có 2 dòng để tối ưu hiển thị
            if num_lines == 2:
                bg_height = int(bg_height * 0.9)
            
            # Đảm bảo chiều cao tối thiểu
            min_height = int(font_size * min_height_factor)
            bg_height = max(bg_height, min_height)
            
            # Tính bán kính bo góc tương ứng với kích thước nền
            corner_radius = min(int(font_size * corner_radius_factor), int(bg_height / 4))
            if border_radius > 0:
                corner_radius = border_radius
            
            # Tính toán vị trí X của background (căn giữa ngang)
            bg_x_start = int((video_width - bg_width) / 2)
            bg_x_end = bg_x_start + bg_width
            
            # Tính toán vị trí Y dựa trên alignment và marginV
            bg_y_start = 0
            bg_y_end = 0
            
            # Xử lý alignment để xác định vị trí Y
            # Alignment: 1-3 (dưới), 4-6 (giữa), 7-9 (trên)
            if alignment >= 1 and alignment <= 3:
                # Căn dưới - thêm offset 20px để nâng lên
                y_offset_bottom = -20  # Điều chỉnh giá trị này để thay đổi độ cao
                bg_y_end = video_height - margin_v - y_offset_bottom
                bg_y_start = bg_y_end - bg_height
            elif alignment >= 4 and alignment <= 6:
                # Căn giữa
                bg_y_start = int((video_height - bg_height) / 2)
                bg_y_end = bg_y_start + bg_height
            else:
                # Căn trên
                bg_y_start = margin_v
                bg_y_end = bg_y_start + bg_height
            
            # Điều chỉnh vị trí Y để căn giữa text trong background
            # Tính toán offset dựa trên số dòng và alignment
            y_offset = 0
            if num_lines == 1:
                y_offset = int((bg_height - text_height) / 2) # Điều chỉnh căn giữa dọc
            
            # Áp dụng offset dựa trên alignment
            if alignment >= 1 and alignment <= 3:
                # Căn dưới - không cần điều chỉnh
                pass
            elif alignment >= 4 and alignment <= 6:
                # Căn giữa - không cần điều chỉnh
                pass
            else:
                # Căn trên - điều chỉnh bg_y_start
                bg_y_start -= y_offset
                bg_y_end = bg_y_start + bg_height
            
            logger.info(f"Background: Width={bg_width}, Height={bg_height}, X={bg_x_start}, Y={bg_y_start}, Radius={corner_radius}")
            
            # Tạo đường bo góc bằng hàm helper
            scale = 1  # Hệ số scale cho drawing
            drawing = create_rounded_rectangle_drawing(bg_width, bg_height, corner_radius, scale)
            
            # Tạo background với bo góc
            bg_text = "{\\an7\\pos(" + f"{bg_x_start},{bg_y_start}" + ")\\p" + str(scale) + "\\bord0\\shad0\\1c&H" + f"{background_color}" + "&\\1a&H" + f"{alpha_hex}" + "&}" + drawing
            bg_line = f"Dialogue: 0,{event['Start']},{event['End']},Background,,0,0,0,,{bg_text}\n"
            
            # Thêm background vào danh sách sự kiện mới
            new_events.append(bg_line)
            
            # Thêm dialogue gốc vào danh sách sự kiện mới (giữ nguyên layer là 1)
            dialogue_layer = max(1, int(event['Layer']))  # Đảm bảo layer dialogue luôn >= 1
            dialogue_line = f"Dialogue: {dialogue_layer},{event['Start']},{event['End']},{event['Style']},{event['Name']},{event['MarginL']},{event['MarginR']},{event['MarginV']},{event['Effect']},{event['Text']}\n"
            new_events.append(dialogue_line)

        # Thêm tất cả các sự kiện mới vào nội dung ASS
        new_ass_content.extend(new_events)

        # Ghi file mới
        with open(output_ass, 'w', encoding='utf-8') as f:
            f.writelines(new_ass_content)
            
        # Kiểm tra highlight color trong file đầu ra
        highlight_found = False
        with open(output_ass, 'r', encoding='utf-8') as f:
            for line in f:
                if line.startswith("Dialogue:") and "\\1c&H" in line:
                    highlight_found = True
                    logger.info(f"Đã tìm thấy highlight color trong dòng sau khi áp dụng bo góc: {line.strip()}")
                    break
        
        if not highlight_found:
            logger.warning("Không tìm thấy highlight color trong file ASS sau khi áp dụng bo góc")

    except Exception as e:
        logger.error(f"Lỗi khi áp dụng hiệu ứng: {str(e)}")
        raise

def extract_sentence_segments(result):
    """
    Trích xuất segments theo câu hoàn chỉnh từ kết quả phiên âm.
    Một câu hoàn chỉnh được xác định bởi:
    - Kết thúc bằng dấu câu (. ? ! ... )
    - Hoặc khoảng cách thời gian đủ lớn giữa các segments (> 0.8s)
    
    Args:
        result: Kết quả phiên âm (WhisperResult)
        
    Returns:
        list: Danh sách các segment theo câu hoàn chỉnh
    """
    sentence_segments = []
    current_segment = {
        "text": "",
        "start": None,
        "end": None
    }
    
    # Các dấu câu kết thúc
    end_punctuations = ['.', '?', '!', '...', '।', '。', '？', '！']
    
    for segment in result.segments:
        text = segment.text.strip()
        if not text:
            continue
            
        # Bắt đầu segment mới nếu chưa có
        if current_segment["start"] is None:
            current_segment["start"] = segment.start
            
        # Thêm text vào segment hiện tại
        current_segment["text"] += " " + text if current_segment["text"] else text
        current_segment["end"] = segment.end
        
        # Kiểm tra điều kiện kết thúc câu
        is_end_of_sentence = False
        
        # Kiểm tra dấu câu kết thúc
        for punct in end_punctuations:
            if text.endswith(punct):
                is_end_of_sentence = True
                break
        
        # Kiểm tra khoảng cách với segment tiếp theo
        next_segment = None
        segments = result.segments
        current_index = segments.index(segment)
        if current_index < len(segments) - 1:
            next_segment = segments[current_index + 1]
            
        # Nếu khoảng cách với segment tiếp theo > 0.8s, coi như kết thúc câu
        if next_segment and (next_segment.start - segment.end) > 0.8:
            is_end_of_sentence = True
        
        # Nếu là kết thúc câu, thêm segment vào kết quả
        if is_end_of_sentence and current_segment["text"].strip():
            sentence_segments.append({
                "id": len(sentence_segments),
                "start": current_segment["start"],
                "end": current_segment["end"],
                "text": current_segment["text"].strip()
            })
            # Reset segment hiện tại
            current_segment = {
                "text": "",
                "start": None,
                "end": None
            }
    
    # Thêm segment cuối cùng nếu còn
    if current_segment["text"].strip():
        sentence_segments.append({
            "id": len(sentence_segments),
            "start": current_segment["start"],
            "end": current_segment["end"],
            "text": current_segment["text"].strip()
        })
    
    return sentence_segments

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000) 