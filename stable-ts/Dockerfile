# Sử dụng CUDA 12.2.0-base-ubuntu22.04 làm image nền
FROM nvidia/cuda:12.2.0-base-ubuntu22.04

# Cài đặt các dependency hệ thống: ffmpeg, python3, pip, git và git-lfs để tải model (LFS)
RUN apt-get update && apt-get install -y \
    ffmpeg \
    python3 \
    python3-pip \
    git \
    git-lfs \
    libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

# Cấu hình git-lfs
RUN git lfs install

# Thiết lập thư mục làm việc
WORKDIR /app

# Cài đặt các package Python cần thiết:
# - fastapi và uvicorn để triển khai API
# - torch (với phiên bản hỗ trợ CUDA) và stable-ts từ GitHub
# - huggingface_hub để tải model từ Hugging Face
RUN pip3 install --no-cache-dir uvicorn fastapi
RUN pip3 install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cu124
RUN pip3 install --no-cache-dir git+https://github.com/jianfch/stable-ts.git
RUN pip3 install --no-cache-dir python-multipart
RUN pip3 install --no-cache-dir transformers
RUN pip3 install --no-cache-dir 'accelerate>=0.26.0'
RUN pip3 install --no-cache-dir huggingface_hub
RUN pip3 install --no-cache-dir librosa soundfile

# Cài đặt các gói bổ sung cho PhoWhisper
RUN pip3 install --no-cache-dir sentencepiece
RUN pip3 install --no-cache-dir datasets
RUN pip3 install --no-cache-dir safetensors

# Cài đặt các thư viện hỗ trợ PhoWhisper-large và Stable-ts
RUN pip3 install --no-cache-dir "stable-ts[hf]" pydub

# Cấu hình PyTorch để tối ưu bộ nhớ
ENV PYTORCH_CUDA_ALLOC_CONF="expandable_segments:True"

# Tạo thư mục cho mô hình - mục này sẽ được mount từ volume bên ngoài
RUN mkdir -p /models/vinai/PhoWhisper-large

# Tạo script Python để tải và kiểm tra mô hình
RUN echo '#!/usr/bin/env python3\n\
import os\n\
import sys\n\
import logging\n\
from pathlib import Path\n\
import stable_whisper\n\
from huggingface_hub import snapshot_download\n\
\n\
logging.basicConfig(level=logging.INFO)\n\
logger = logging.getLogger(__name__)\n\
\n\
def download_model():\n\
    model_id = "vinai/PhoWhisper-large"\n\
    local_dir = "/models/vinai/PhoWhisper-large"\n\
    local_path = Path(local_dir)\n\
    \n\
    # Kiểm tra xem mô hình đã tồn tại ở local chưa\n\
    required_files = ["pytorch_model.bin", "config.json", "tokenizer.json", "preprocessor_config.json"]\n\
    \n\
    # Kiểm tra mô hình đã có đầy đủ các file cần thiết chưa\n\
    files_exist = local_path.exists() and all([(local_path / file).exists() for file in required_files])\n\
    \n\
    if files_exist:\n\
        logger.info(f"Sử dụng mô hình đã tải trước tại: {local_path}")\n\
        files = list(local_path.iterdir())\n\
        logger.info(f"Các tệp có trong thư mục: {[f.name for f in files]}")\n\
        return local_path\n\
    \n\
    # Nếu chưa có đầy đủ, tải từ Hugging Face\n\
    logger.info(f"Tải mô hình {model_id} từ Hugging Face Hub")\n\
    try:\n\
        # Tải mô hình từ Hugging Face Hub\n\
        snapshot_download(\n\
            repo_id=model_id,\n\
            local_dir=str(local_path),\n\
            resume_download=True,\n\
            ignore_patterns=["*.msgpack", "*.h5"]\n\
        )\n\
        logger.info(f"Đã tải mô hình {model_id} thành công")\n\
        \n\
        # Kiểm tra các tệp đã tải\n\
        files = list(local_path.iterdir())\n\
        logger.info(f"Các tệp có trong thư mục: {[f.name for f in files]}")\n\
        \n\
        return local_path\n\
    except Exception as e:\n\
        logger.error(f"Lỗi khi tải mô hình từ Hugging Face: {str(e)}")\n\
        sys.exit(1)\n\
\n\
def test_model_loading():\n\
    model_path = download_model()\n\
    try:\n\
        # Trước tiên, thử kiểm tra nếu mô hình tồn tại với transformer\n\
        logger.info("Kiểm tra tải mô hình với transformers...")\n\
        from transformers import WhisperForConditionalGeneration, WhisperProcessor\n\
        processor = WhisperProcessor.from_pretrained(str(model_path))\n\
        model = WhisperForConditionalGeneration.from_pretrained(str(model_path))\n\
        logger.info("Tải mô hình với transformers thành công!")\n\
        \n\
        # Thử tải mô hình với stable_whisper\n\
        logger.info("Kiểm tra tải mô hình với stable_whisper...")\n\
        try:\n\
            # Thử phương pháp 1: Sử dụng load_hf_whisper với no_safetensors=True\n\
            sw_model = stable_whisper.load_hf_whisper(\n\
                str(model_path),\n\
                device="cpu",  # Sử dụng CPU để kiểm tra\n\
                compute_type="float32",\n\
                no_safetensors=True\n\
            )\n\
            logger.info("Tải mô hình với stable_whisper.load_hf_whisper thành công!")\n\
            return True\n\
        except Exception as e:\n\
            logger.warning(f"Lỗi khi tải mô hình với stable_whisper.load_hf_whisper: {str(e)}")\n\
            logger.info("Thử phương pháp 2...")\n\
            \n\
            # Thử phương pháp 2: Tạo trực tiếp một WhisperModel từ transformers model\n\
            sw_model = stable_whisper.WhisperModel(model, processor, device="cpu", compute_type="float32")\n\
            logger.info("Tải mô hình với WhisperModel thành công!")\n\
            return True\n\
    except Exception as e:\n\
        logger.error(f"Lỗi khi tải mô hình: {str(e)}")\n\
        return False\n\
\n\
if __name__ == "__main__":\n\
    import torch\n\
    download_model()\n\
    test_model_loading()\n\
' > /app/download_model.py && chmod +x /app/download_model.py

# Tạo script khởi động để kiểm tra và tải mô hình trước khi khởi động API
RUN echo '#!/bin/bash\n\
python3 /app/download_model.py\n\
exec uvicorn api_server:app --host 0.0.0.0 --port 8000\n\
' > /app/start.sh && chmod +x /app/start.sh

# Copy mã nguồn FastAPI (api_server.py) vào image
COPY api_server.py .

# Mở cổng 8000 để cho phép truy cập API từ bên ngoài container
EXPOSE 8000

# Sửa lại đường dẫn mô hình trong file api_server.py
RUN sed -i 's/MODEL_PATH = "\/app\/models\/vinai\/PhoWhisper-large"/MODEL_PATH = "\/models\/vinai\/PhoWhisper-large"/g' /app/api_server.py

# CMD khởi chạy script start.sh để kiểm tra/tải mô hình trước khi khởi động API
CMD ["/app/start.sh"]
