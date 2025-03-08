from fastapi import FastAPI, UploadFile, File, HTTPException, Request
import stable_whisper
import tempfile
import os
import logging
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
async def transcribe(file: UploadFile = File(...)):
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
                logger.info("Bắt đầu transcribe")
                result = model.transcribe(tmp.name, language="vi")
                logger.info("Transcribe thành công")
                
                # Xuất kết quả ở định dạng ASS
                ass_output = result.to_ass()
                logger.info("Tạo phụ đề ASS thành công")
                
                # Xóa file tạm sau khi xử lý xong
                os.unlink(tmp.name)
                logger.info(f"Đã xóa file tạm: {tmp.name}")
                
                return {"text": result.text, "ass": ass_output}
            except Exception as e:
                logger.error(f"Lỗi khi xử lý transcribe: {str(e)}")
                raise HTTPException(status_code=500, detail=f"Lỗi khi xử lý transcribe: {str(e)}")
    except Exception as e:
        logger.error(f"Lỗi khi xử lý file: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Lỗi khi xử lý file: {str(e)}")

@app.get("/health")
async def health_check():
    if model is None:
        return {"status": "error", "message": "Model chưa được tải"}
    return {"status": "ok", "message": "API đang hoạt động bình thường"}
