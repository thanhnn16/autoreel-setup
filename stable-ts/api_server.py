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
        _model = stable_whisper.load_model("large-v3", device=_device)
        logger.info(f"Đã tải mô hình large-v3 trên {_device}")
    except Exception as e:
        logger.warning(f"Không thể tải mô hình large-v3: {str(e)}")
        logger.info("Thử tải mô hình turbo...")
        _model = stable_whisper.load_model("turbo", device=_device)
        logger.info("Đã tải mô hình turbo")
    
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
    font_size: int = Form(72),
    highlight_color: str = Form('05C2ED'),
    border_radius: int = Form(10),
    
    # Các tham số định dạng ASS
    background_color: str = Form('80000000'),
    primary_color: str = Form('FFFFFF'),
    outline_color: str = Form('000000'),
    outline: int = Form(2),
    shadow: int = Form(2),
    alignment: int = Form(2),
    margin_l: int = Form(16),
    margin_r: int = Form(16),
    margin_v: int = Form(56),
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
    Xử lý audio với transcribe mặc định.
    
    Args:
        model: Mô hình stable-ts đã tải
        audio_path: Đường dẫn đến file audio
        language: Ngôn ngữ (mặc định là "vi")
        
    Returns:
        WhisperResult: Kết quả phiên âm
    """
    # Sử dụng transcribe mặc định
    result = model.transcribe(str(audio_path), language=language)
    return result

def apply_rounded_borders(input_ass: Path, output_ass: Path, border_radius: int = 10):
    """
    Áp dụng bo góc cho file ASS và đảm bảo giữ nguyên hiệu ứng highlight từng từ
    Tối ưu cho video kích thước 1080x1920 (chiều rộng x chiều cao)
    Xử lý tốt các trường hợp text 1 dòng, 2 dòng, text ngắn và dài
    Đảm bảo layer của dialogue luôn là 1 và layer của background luôn là 0
    """
    try:
        with open(input_ass, 'r', encoding='utf-8') as f:
            lines = f.readlines()

        # Kiểm tra highlight color trong các dòng Dialogue
        highlight_found = False
        for line in lines:
            if line.startswith("Dialogue:") and "\\1c&H" in line:
                highlight_found = True
                logger.info(f"Đã tìm thấy highlight color trong dòng trước khi áp dụng bo góc: {line.strip()}")
                break
        
        if not highlight_found:
            logger.warning("Không tìm thấy highlight color trong file ASS trước khi áp dụng bo góc")

        # Cập nhật PlayResX và PlayResY để phù hợp với kích thước video
        video_width = 1080
        video_height = 1920
        
        # Cập nhật hoặc thêm PlayResX và PlayResY
        has_play_res_x = False
        has_play_res_y = False
        
        for i, line in enumerate(lines):
            if line.startswith("PlayResX:"):
                lines[i] = f"PlayResX: {video_width}\n"
                has_play_res_x = True
            elif line.startswith("PlayResY:"):
                lines[i] = f"PlayResY: {video_height}\n"
                has_play_res_y = True
        
        # Thêm nếu chưa có
        if not has_play_res_x or not has_play_res_y:
            for i, line in enumerate(lines):
                if line.startswith("[Script Info]"):
                    if not has_play_res_x:
                        lines.insert(i+1, f"PlayResX: {video_width}\n")
                    if not has_play_res_y:
                        lines.insert(i+1, f"PlayResY: {video_height}\n")
                    break

        # Lấy thông tin style từ file ASS
        default_style = None
        for line in lines:
            if line.startswith("Style: Default,"):
                default_style = line
                logger.info(f"Style Default trong file ASS: {default_style.strip()}")
                break
        
        # Phân tích style để lấy thông tin font size và margin
        font_size = 72  # Giá trị mặc định
        margin_v = 56   # Giá trị mặc định
        
        if default_style:
            style_parts = default_style.split(',')
            if len(style_parts) > 2:
                try:
                    font_size = int(style_parts[2])
                    logger.info(f"Đã đọc font size từ style: {font_size}")
                except ValueError:
                    pass
            
            if len(style_parts) > 18:
                try:
                    margin_v = int(style_parts[18])
                except ValueError:
                    pass

        # QUAN TRỌNG: KHÔNG thay đổi style Default, giữ nguyên font size và các thuộc tính khác
        
        # Thêm style cho background theo yêu cầu
        bg_style = (
            "Style: Background,Arial,20,&H80000000,&H000000FF,&H00000000,&H00000000,"
            "0,0,0,0,100,100,0,0,3,2,2,2,16,16,56,1\n"
        )
        
        # Định dạng Format cho phần Styles
        format_line = "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n"
        
        # Tìm và sắp xếp lại phần [V4+ Styles] để đảm bảo Format xuất hiện trước Style
        v4_styles_index = -1
        for i, line in enumerate(lines):
            if line.strip() == "[V4+ Styles]":
                v4_styles_index = i
                break
        
        if v4_styles_index >= 0:
            # Xóa phần [V4+ Styles] cũ
            styles_section = []
            i = v4_styles_index
            styles_section.append(lines[i])  # Thêm dòng [V4+ Styles]
            i += 1
            
            # Thu thập tất cả các dòng trong phần Styles
            while i < len(lines) and not lines[i].strip().startswith('['):
                if not lines[i].strip().startswith('Format:') and not lines[i].strip().startswith('Style:'):
                    styles_section.append(lines[i])
                i += 1
            
            # Thêm Format và các Style theo đúng thứ tự
            styles_section.append(format_line)
            
            # Thu thập tất cả các Style hiện có
            styles = []
            for line in lines:
                if line.strip().startswith('Style:'):
                    styles.append(line)
            
            # Thêm Style Background nếu chưa có
            has_bg_style = False
            for style in styles:
                if style.startswith("Style: Background,"):
                    has_bg_style = True
                    break
            
            if not has_bg_style:
                styles.append(bg_style)
            
            # Thêm tất cả các Style vào phần Styles
            styles_section.extend(styles)
            
            # Xóa phần [V4+ Styles] cũ và thay thế bằng phần mới
            lines = lines[:v4_styles_index] + styles_section + lines[i:]
        
        # Xử lý các event, giữ nguyên hiệu ứng highlight từng từ
        new_events = []
        events_section = False
        
        # Tìm phần [Events] trong file
        for i, line in enumerate(lines):
            # Giữ nguyên tất cả các dòng cho đến khi gặp phần [Events]
            if line.strip() == "[Events]":
                events_section = True
                new_events.append(line)
                
                # Thêm dòng Format nếu có
                if i+1 < len(lines) and lines[i+1].startswith("Format:"):
                    new_events.append(lines[i+1])
                continue
            
            # Nếu chưa đến phần [Events], giữ nguyên dòng
            if not events_section:
                new_events.append(line)
                continue
            
            # Bỏ qua dòng Format trong phần [Events] (đã thêm ở trên)
            if line.startswith("Format:"):
                continue
            
            # Xử lý các dòng Dialogue
            if line.startswith("Dialogue:"):
                parts = line.split(',', 9)
                if len(parts) < 10:
                    # Nếu dòng Dialogue không đúng định dạng, giữ nguyên
                    new_events.append(line)
                    continue
                
                # Lấy thông tin từ dòng Dialogue
                layer = parts[0].split(':')[1].strip()
                start_time = parts[1]
                end_time = parts[2]
                style = parts[3]
                text = parts[9]
                
                # Nếu đã là background hoặc có style Background, giữ nguyên
                if style == "Background" or "Background" in line:
                    new_events.append(line)
                    continue
                
                # Tính toán kích thước background dựa trên độ dài text và font size
                text_length = len(text.strip())
                
                # Tính toán chiều rộng background dựa trên độ dài text
                # Công thức ước lượng: mỗi ký tự chiếm khoảng 0.6 * font_size pixel chiều rộng
                estimated_width = min(int(text_length * 0.6 * font_size), int(video_width * 0.9))
                
                # Đảm bảo chiều rộng tối thiểu
                bg_width = max(estimated_width, int(video_width * 0.3))
                
                # Tính toán chiều cao background dựa trên số dòng text
                # Ước tính số dòng dựa trên độ dài text và chiều rộng background
                estimated_chars_per_line = int(bg_width / (0.6 * font_size))
                estimated_lines = max(1, int(text_length / estimated_chars_per_line) + 1)
                
                # Chiều cao background: mỗi dòng text chiếm khoảng 1.2 * font_size pixel
                bg_height = int(estimated_lines * 1.2 * font_size) + margin_v
                
                # Tính toán vị trí để căn giữa background
                bg_x_start = int((video_width - bg_width) / 2)
                bg_y_start = int(video_height * 0.75) - bg_height  # Đặt ở khoảng 75% chiều cao video
                
                bg_x_end = bg_x_start + bg_width
                bg_y_end = bg_y_start + bg_height
                
                # Tạo background layer với định dạng theo yêu cầu và vị trí đã tính toán
                bg_text = (
                    r"{\\blur2\\bord24\\xbord12\\ybord12\\3c&H000000&\\alpha&H90&\\p1}"
                    f"m {bg_x_start} {bg_y_start} l {bg_x_end} {bg_y_start} {bg_x_end} {bg_y_end} {bg_x_start} {bg_y_end}"
                    r"{\\p0}"
                )
                
                # Đảm bảo layer của background luôn là 0
                bg_line = f"Dialogue: 0,{start_time},{end_time},Background,,0,0,0,,{bg_text}\n"

                # QUAN TRỌNG: KHÔNG thay đổi text gốc để đảm bảo hiệu ứng karaoke hoạt động đúng
                # Giữ nguyên text gốc với tất cả các tag style
                modified_text = text
                
                # Đảm bảo layer của dialogue luôn là 1 (giữ nguyên layer gốc nếu lớn hơn 1)
                dialogue_layer = max(1, int(layer))
                
                # Tạo lại dòng Dialogue với các thông số gốc, chỉ thay đổi layer nếu cần
                dialogue_parts = line.split(',', 1)  # Tách phần layer và phần còn lại
                dialogue_line = f"Dialogue: {dialogue_layer}," + dialogue_parts[1]  # Giữ nguyên phần còn lại
                
                # Thêm layer background TRƯỚC layer text
                new_events.append(bg_line)
                new_events.append(dialogue_line)
            else:
                # Giữ lại các dòng không phải Dialogue
                new_events.append(line)

        # Ghi file mới
        with open(output_ass, 'w', encoding='utf-8') as f:
            f.writelines(new_events)
            
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