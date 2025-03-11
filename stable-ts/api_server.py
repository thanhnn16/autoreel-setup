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
    font_size: int = Form(24),
    highlight_color: str = Form('05c2ed'),
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
    margin_v: int = Form(48),
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
            'PrimaryColour': f"&H{primary_color}",
            'OutlineColour': f"&H{outline_color}",
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
        result.to_ass(
            str(temp_ass),
            highlight_color=highlight_color,
            **ass_style_kwargs
        )
        
        # Áp dụng bo góc
        logger.info(f"Áp dụng bo góc với bán kính {border_radius}")
        try:
            apply_rounded_borders(temp_ass, output_path, border_radius)
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
    """
    try:
        with open(input_ass, 'r', encoding='utf-8') as f:
            lines = f.readlines()

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

        # Thêm style cho background theo yêu cầu
        bg_style = (
            "Style: Background,Arial,20,&H80000000,&H000000FF,&H00000000,&H00000000,"
            "0,0,0,0,100,100,0,0,1,2,2,2,16,16,48,1\n"
        )
        
        # Tìm và chèn style background nếu chưa có
        has_bg_style = False
        for i, line in enumerate(lines):
            if line.startswith("Style: Background,"):
                lines[i] = bg_style  # Thay thế style hiện có
                has_bg_style = True
                break
                
        if not has_bg_style:
            for i, line in enumerate(lines):
                if line.startswith("[V4+ Styles]"):
                    lines.insert(i+1, bg_style)  # Chèn ngay sau section header
                    break

        # Xử lý các event, giữ nguyên hiệu ứng highlight từng từ
        new_events = []
        
        # Tính toán kích thước background phù hợp
        # Sử dụng chiều rộng là 80% của video và chiều cao cố định 100px
        bg_width = int(video_width * 0.8)  # 80% chiều rộng video
        bg_height = 100  # Chiều cao cố định
        
        # Tính toán vị trí để căn giữa background
        bg_x_start = int((video_width - bg_width) / 2)
        bg_y_start = int(video_height * 0.8)  # Đặt ở khoảng 80% chiều cao video
        
        bg_x_end = bg_x_start + bg_width
        bg_y_end = bg_y_start + bg_height
        
        for line in lines:
            if line.startswith("Dialogue:"):
                parts = line.split(',', 9)
                if len(parts) < 10:
                    continue
                
                layer = parts[0].split(":")[1].strip()
                start_time = parts[1]
                end_time = parts[2]
                style = parts[3]
                text = parts[9]
                
                # Nếu đã là background, bỏ qua
                if style == "Background":
                    continue
                
                # Tạo background layer với định dạng theo yêu cầu và vị trí đã tính toán
                bg_text = (
                    r"{\\blur2\\bord24\\xbord12\\ybord12\\3c&H000000&\\alpha&H90&\\p1}"
                    f"m {bg_x_start} {bg_y_start} l {bg_x_end} {bg_y_start} {bg_x_end} {bg_y_end} {bg_x_start} {bg_y_end}"
                    r"{\\p0}"
                )
                bg_line = f"Dialogue: 0,{start_time},{end_time},Background,,0,0,0,,{bg_text}\n"

                # QUAN TRỌNG: KHÔNG thêm tag style vào trước tag karaoke
                # Giữ nguyên text gốc để đảm bảo hiệu ứng karaoke hoạt động đúng
                modified_text = text
                
                # Thêm layer background TRƯỚC layer text
                new_events.append(bg_line)
                new_events.append(f"Dialogue: {layer},{start_time},{end_time},{style},,0,0,0,,{modified_text}")

        # Thay thế các event cũ bằng event mới
        lines = [line for line in lines if not line.startswith("Dialogue:")]
        lines += new_events  # Giữ nguyên các phần khác của file

        with open(output_ass, 'w', encoding='utf-8') as f:
            f.writelines(lines)

    except Exception as e:
        logger.error(f"Lỗi khi áp dụng hiệu ứng: {str(e)}")
        shutil.copy(input_ass, output_ass)
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