#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import os
import torch
import tempfile
import logging
import time
import gc
from pathlib import Path
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Query
from fastapi.responses import FileResponse
import stable_whisper

# Cấu hình logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Tạo thư mục tạm cho các file
TEMP_DIR = Path("/tmp/stable_ts_tmp")
TEMP_DIR.mkdir(exist_ok=True, parents=True)

# Khởi tạo FastAPI app
app = FastAPI(
    title="Stable-ts API",
    description="API để chuyển đổi âm thanh thành văn bản sử dụng Stable-ts",
    version="1.0.0"
)

# Biến toàn cục để lưu trữ mô hình đã tải
_model = None
_device = None

def get_model(force_cpu=False):
    """
    Hàm lazy-loading để khởi tạo mô hình một lần duy nhất
    
    Args:
        force_cpu (bool): Nếu True, sẽ sử dụng CPU ngay cả khi có GPU
    """
    global _model, _device
    
    # Nếu yêu cầu chạy trên CPU hoặc không có GPU
    if force_cpu or not torch.cuda.is_available():
        device = "cpu"
        compute_type = "float32"
        use_dq = True  # Kích hoạt dynamic quantization cho CPU
    else:
        device = "cuda"
        compute_type = "float16"
        use_dq = False  # Dynamic quantization chỉ hoạt động trên CPU
    
    # Nếu đã có mô hình nhưng yêu cầu đổi thiết bị
    if _model is not None and _device != device:
        logger.info(f"Chuyển mô hình từ {_device} sang {device}")
        # Giải phóng bộ nhớ GPU nếu có
        if _device == "cuda":
            _model = None
            torch.cuda.empty_cache()
            gc.collect()
    
    # Nếu chưa có mô hình hoặc đã giải phóng mô hình
    if _model is None:
        logger.info(f"Tải mô hình với thiết bị: {device}, dynamic_quantization: {use_dq}")
        _device = device
        
        try:
            # Sử dụng mô hình vi-whisper-large-v3-turbo từ HuggingFace với optimizations
            # Sử dụng HF Transformers cho tốc độ nhanh hơn (lên đến 9x)
            logger.info("Sử dụng tối ưu hóa Hugging Face Transformers cho tốc độ nhanh hơn")
            
            # Thiết lập các tham số phù hợp với Hugging Face pipeline
            model_kwargs = {
                "device": device,
                "torch_dtype": torch.float16 if device == "cuda" else torch.float32,
                "attn_implementation": "eager"  # Thêm tham số này để tránh cảnh báo
            }
            
            try:
                _model = stable_whisper.load_hf_whisper(
                    'suzii/vi-whisper-large-v3-turbo',
                    **model_kwargs
                )
                logger.info("Đã tải mô hình Whisper từ Hugging Face thành công")
            except TypeError as type_err:
                # Xử lý trường hợp lỗi tham số
                logger.warning(f"Có lỗi tham số khi tải mô hình: {str(type_err)}")
                logger.info("Thử lại với tham số tối thiểu...")
                # Thử lại với ít tham số hơn
                _model = stable_whisper.load_hf_whisper(
                    'suzii/vi-whisper-large-v3-turbo',
                    device=device
                )
            
            logger.info("Lưu ý: Alignment và Refinement không được hỗ trợ trên các mô hình Hugging Face")
            
            # Nếu sử dụng CPU và dynamic quantization
            if device == "cpu" and use_dq:
                logger.info("Áp dụng dynamic quantization cho mô hình trên CPU")
                # Sử dụng dynamic quantization cho CPU
                try:
                    # Kiểm tra xem đối tượng có hỗ trợ quantization không
                    if hasattr(_model, 'model'):
                        # Thử quantize mô hình bên trong nếu có
                        torch.quantization.quantize_dynamic(
                            _model.model, {torch.nn.Linear}, dtype=torch.qint8, inplace=True
                        )
                    elif hasattr(_model, 'feature_extractor') and hasattr(_model, 'tokenizer') and hasattr(_model, 'encoder') and hasattr(_model, 'decoder'):
                        # Thử quantize các thành phần riêng lẻ của mô hình Whisper
                        for component in [_model.encoder, _model.decoder]:
                            if hasattr(component, 'eval'):
                                component.eval()
                                torch.quantization.quantize_dynamic(
                                    component, {torch.nn.Linear}, dtype=torch.qint8, inplace=True
                                )
                    else:
                        logger.warning("Không thể áp dụng quantization: cấu trúc mô hình không hỗ trợ")
                except Exception as q_err:
                    logger.warning(f"Không thể áp dụng quantization: {str(q_err)}")
                
            logger.info("Đã tải mô hình tiếng Việt thành công!")
            
        except Exception as e:
            logger.error(f"Lỗi khi tải mô hình: {str(e)}")
            raise RuntimeError(f"Không thể tải mô hình: {str(e)}")
    
    return _model

@app.on_event("startup")
async def startup_event():
    """
    Khởi tạo mô hình khi khởi động server
    """
    try:
        # Cấu hình PyTorch để tối ưu việc sử dụng bộ nhớ
        if torch.cuda.is_available():
            # Thiết lập cấu hình để tránh phân mảnh bộ nhớ
            os.environ["PYTORCH_CUDA_ALLOC_CONF"] = "expandable_segments:True"
            logger.info(f"Phát hiện GPU: {torch.cuda.get_device_name(0)}")
            logger.info(f"Bộ nhớ GPU khả dụng: {torch.cuda.get_device_properties(0).total_memory / 1024**3:.2f} GB")
            
            # Đặt seed cho PyTorch để đảm bảo tính nhất quán
            torch.manual_seed(42)
            if torch.cuda.is_available():
                torch.cuda.manual_seed_all(42)
        else:
            logger.info("Không phát hiện GPU, sẽ sử dụng CPU")
        
        # Bỏ qua cảnh báo từ thư viện transformers về inputs/input_features
        import warnings
        warnings.filterwarnings("ignore", message="The input name `inputs` is deprecated")
        
        # Tải mô hình ngay khi khởi động server
        logger.info("Bắt đầu tải mô hình khi khởi động server...")
        get_model()
        logger.info("Đã tải mô hình thành công, server sẵn sàng phục vụ!")
    except Exception as e:
        logger.error(f"Lỗi khi khởi tạo: {str(e)}")
        logger.warning("Server sẽ vẫn khởi động, nhưng mô hình sẽ được tải lại khi có yêu cầu đầu tiên.")

@app.get("/")
async def root():
    """
    Endpoint thông tin
    """
    device = "cuda" if torch.cuda.is_available() else "cpu"
    return {
        "name": "Stable-ts API",
        "status": "online",
        "device": device,
        "usage": "POST /transcribe với file âm thanh để chuyển đổi thành văn bản"
    }

@app.post("/transcribe")
async def transcribe_audio(
    file: UploadFile = File(...),
    format: str = Form("txt"),
    use_cpu: bool = Form(False)
):
    """
    Endpoint chuyển đổi âm thanh thành văn bản
    
    - **file**: File âm thanh cần chuyển đổi
    - **format**: Định dạng đầu ra (txt, srt, vtt, ass)
    - **use_cpu**: Sử dụng CPU thay vì GPU để tránh lỗi bộ nhớ
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
        
        # Kiểm tra định dạng đầu ra
        if format not in ["txt", "srt", "vtt", "ass"]:
            format = "txt"  # Mặc định là văn bản thuần
        
        # Cố gắng xử lý file âm thanh
        try:
            # Thử sử dụng GPU nếu không yêu cầu CPU
            model = get_model(force_cpu=use_cpu)
            
            # Đo thời gian xử lý
            start_time = time.time()
            
            # Chạy transcribe với tham số tối ưu cho tốc độ
            try:
                logger.info(f"Transcribing with Hugging Face Whisper (suzii/vi-whisper-large-v3-turbo)...")
                
                # Thử sử dụng phương pháp có xử lý attention mask
                try:
                    result = process_audio_with_attention_mask(model, temp_file, language="vi")
                except Exception as e:
                    logger.warning(f"Không thể sử dụng xử lý attention mask tùy chỉnh: {str(e)}")
                    # Quay lại phương pháp cũ
                    transcribe_options = {
                        "language": "vi",  # Xác định ngôn ngữ tiếng Việt
                    }
                    
                    if hasattr(model, 'pipeline') and hasattr(model.pipeline, 'model'):
                        # Nếu là mô hình HF pipeline, thêm attn_implementation
                        transcribe_options['generate_kwargs'] = {
                            'attn_implementation': 'eager'
                        }
                    
                    result = model.transcribe(
                        str(temp_file),
                        **transcribe_options
                    )
            except TypeError as type_err:
                # Nếu vẫn có lỗi về tham số, thử lại với tham số tối thiểu
                logger.warning(f"Lỗi tham số khi gọi transcribe: {str(type_err)}")
                logger.info("Thử lại với tham số tối thiểu...")
                result = model.transcribe(str(temp_file))
            
            process_time = time.time() - start_time
            logger.info(f"Thời gian xử lý: {process_time:.2f} giây, với thiết bị: {_device}")
            
        except RuntimeError as e:
            if "CUDA out of memory" in str(e) and not use_cpu:
                # Nếu gặp lỗi CUDA OOM và đang dùng GPU, chuyển sang CPU
                logger.warning("CUDA out of memory, chuyển sang sử dụng CPU với dynamic quantization...")
                
                # Giải phóng bộ nhớ GPU triệt để
                global _model
                if _model is not None:
                    _model = None
                
                # Buộc PyTorch sử dụng CPU
                os.environ["CUDA_VISIBLE_DEVICES"] = ""
                torch.cuda.empty_cache()
                gc.collect()
                
                try:
                    # Thử lại với CPU
                    model = get_model(force_cpu=True)
                    # Sử dụng cùng phương pháp xử lý attention mask
                    result = process_audio_with_attention_mask(model, temp_file, language="vi")
                    process_time = time.time() - start_time
                    logger.info(f"Thời gian xử lý trên CPU: {process_time:.2f} giây")
                except Exception as cpu_err:
                    logger.error(f"Lỗi khi thử lại trên CPU: {str(cpu_err)}")
                    raise HTTPException(
                        status_code=500,
                        detail=f"Không thể xử lý file âm thanh, ngay cả khi sử dụng CPU: {str(cpu_err)}"
                    )
            else:
                # Lỗi khác không phải OOM
                logger.error(f"Lỗi khi xử lý file âm thanh: {str(e)}")
                raise HTTPException(
                    status_code=500,
                    detail=f"Không thể xử lý file âm thanh: {str(e)}"
                )
        
        # Tạo file output
        output_file = TEMP_DIR / f"{temp_file.stem}.{format}"
        
        # Xuất file theo định dạng
        if format == "txt":
            with open(output_file, "w", encoding="utf-8") as f:
                f.write(result.text)
        elif format == "srt":
            result.to_srt(str(output_file))
        elif format == "vtt":
            result.to_vtt(str(output_file))
        elif format == "ass":
            result.to_ass(str(output_file))
        
        # Trả về nội dung văn bản và đường dẫn đến file
        return {
            "text": result.text,
            "file_path": str(output_file),
            "device_used": "cpu" if use_cpu or _device == "cpu" else "cuda",
            "dynamic_quantization": use_cpu or _device == "cpu"  # Thêm thông tin về dynamic quantization
        }
        
    except Exception as e:
        # Các lỗi khác
        logger.error(f"Lỗi khi xử lý file âm thanh: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Không thể xử lý file âm thanh: {str(e)}"
        )

@app.get("/download/{filename}")
async def download_file(filename: str):
    """
    Endpoint tải xuống file kết quả
    
    - **filename**: Tên file có phần mở rộng
    """
    file_path = TEMP_DIR / filename
    
    if not file_path.exists():
        raise HTTPException(
            status_code=404,
            detail="File không tồn tại"
        )
    
    return FileResponse(
        path=file_path,
        media_type="application/octet-stream",
        filename=filename
    )

# Hàm helper để xử lý attention mask nếu cần
def process_audio_with_attention_mask(model, audio_path, language="vi"):
    """
    Hàm xử lý audio với custom attention mask nếu cần thiết
    """
    # Kiểm tra xem model có phải là pipeline HF hay không
    if hasattr(model, 'pipeline') and hasattr(model.pipeline, 'feature_extractor'):
        try:
            import numpy as np
            from transformers import WhisperProcessor
            
            # Nếu model có feature_extractor và processor
            logger.info("Sử dụng xử lý tùy chỉnh với attention mask...")
            
            # Đọc file audio
            import librosa
            audio, sr = librosa.load(str(audio_path), sr=16000)
            
            # Xử lý audio với feature extractor
            processor = model.pipeline.processor if hasattr(model.pipeline, 'processor') else WhisperProcessor.from_pretrained("openai/whisper-large-v3")
            input_features = processor.feature_extractor(audio, sampling_rate=sr, return_tensors="pt").input_features
            
            # Tạo attention mask đúng cách (tất cả là 1 vì không có padding)
            attention_mask = torch.ones_like(input_features[:, :, 0])
            
            # Sử dụng model trực tiếp với attention mask
            if hasattr(model.pipeline, 'model'):
                forced_decoder_ids = processor.get_decoder_prompt_ids(language=language, task="transcribe")
                result = model.pipeline.model.generate(
                    input_features, 
                    attention_mask=attention_mask,
                    forced_decoder_ids=forced_decoder_ids,
                    attn_implementation="eager"
                )
                transcription = processor.batch_decode(result, skip_special_tokens=True)[0]
                return type('obj', (object,), {'text': transcription})
        
        except Exception as e:
            logger.warning(f"Xử lý với attention mask thất bại: {str(e)}")
            logger.info("Chuyển sang phương pháp transcribe thông thường...")
    
    # Nếu không thể xử lý tùy chỉnh, dùng cách thông thường
    return model.transcribe(str(audio_path), language=language)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
