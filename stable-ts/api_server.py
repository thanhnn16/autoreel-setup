from fastapi import FastAPI, UploadFile, File
import stable_whisper
import tempfile

app = FastAPI()

# Tải mô hình PhoWhisper-Large từ thư mục /models/PhoWhisper-large đã được download sẵn
model = stable_whisper.load_model("PhoWhisper-Large", device="cuda", download_root="/models/PhoWhisper-large")

@app.post("/transcribe")
async def transcribe(file: UploadFile = File(...)):
    # Lưu file audio tạm vào đĩa để truyền cho model xử lý
    with tempfile.NamedTemporaryFile(delete=False) as tmp:
        tmp.write(await file.read())
        tmp.flush()
        # Chuyển giọng nói sang văn bản với tiếng Việt
        result = model.transcribe(tmp.name, language="vi")
        # Xuất kết quả ở định dạng ASS
        ass_output = result.to_ass()
    return {"text": result.text, "ass": ass_output}
