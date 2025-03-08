from fastapi import FastAPI, UploadFile, File
import stable_whisper
import tempfile

app = FastAPI()

# Tải PhoWhisper-Large từ thư mục đã tải về
model = stable_whisper.load_model("/models/PhoWhisper-large", device="cuda")

@app.post("/transcribe")
async def transcribe(file: UploadFile = File(...)):
    # Lưu file audio tạm thời trên đĩa
    with tempfile.NamedTemporaryFile(delete=False) as tmp:
        tmp.write(await file.read())
        tmp.flush()
        # Chuyển đổi giọng nói sang văn bản với tiếng Việt
        result = model.transcribe(tmp.name, language="vi")
        # Xuất kết quả ở định dạng ASS
        ass_output = result.to_ass()
    return {"text": result.text, "ass": ass_output}
