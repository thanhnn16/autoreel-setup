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

# Cài đặt các thư viện hỗ trợ PhoWhisper-large và Stable-ts
RUN pip3 install --no-cache-dir "stable-ts[hf]" pydub

# Cấu hình PyTorch để tối ưu bộ nhớ
ENV PYTORCH_CUDA_ALLOC_CONF="expandable_segments:True"

# Tạo thư mục cho mô hình
RUN mkdir -p /app/models/vinai/PhoWhisper-large

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
    local_dir = "/app/models/vinai/PhoWhisper-large"\n\
    local_path = Path(local_dir)\n\
    \n\
    # Kiểm tra xem mô hình đã tồn tại ở local chưa\n\
    if local_path.exists() and any(local_path.iterdir()):\n\
        logger.info(f"Sử dụng mô hình đã tải trước tại: {local_path}")\n\
        return local_path\n\
    \n\
    # Nếu chưa có, tải từ Hugging Face\n\
    logger.info(f"Tải mô hình {model_id} từ Hugging Face Hub")\n\
    try:\n\
        # Tải mô hình từ Hugging Face Hub\n\
        snapshot_download(\n\
            repo_id=model_id,\n\
            local_dir=str(local_path),\n\
            local_dir_use_symlinks=False\n\
        )\n\
        logger.info(f"Đã tải mô hình {model_id} thành công")\n\
        return local_path\n\
    except Exception as e:\n\
        logger.error(f"Lỗi khi tải mô hình từ Hugging Face: {str(e)}")\n\
        sys.exit(1)\n\
\n\
def test_model_loading():\n\
    model_path = download_model()\n\
    try:\n\
        # Thử tải mô hình với stable_whisper\n\
        logger.info("Kiểm tra tải mô hình với stable_whisper...")\n\
        model = stable_whisper.load_hf_whisper(\n\
            str(model_path),\n\
            device="cuda" if torch.cuda.is_available() else "cpu",\n\
            compute_type="float16" if torch.cuda.is_available() else "float32"\n\
        )\n\
        logger.info("Tải mô hình thành công!")\n\
        return True\n\
    except Exception as e:\n\
        logger.error(f"Lỗi khi tải mô hình với stable_whisper: {str(e)}")\n\
        return False\n\
\n\
if __name__ == "__main__":\n\
    import torch\n\
    download_model()\n\
    test_model_loading()\n\
' > /app/download_model.py && chmod +x /app/download_model.py

# Tải mô hình PhoWhisper-large từ Hugging Face và kiểm tra
RUN python3 /app/download_model.py

# Copy mã nguồn FastAPI (api_server.py) vào image
COPY api_server.py .

# Mở cổng 8000 để cho phép truy cập API từ bên ngoài container
EXPOSE 8000

# CMD khởi chạy uvicorn để phục vụ API
CMD ["uvicorn", "api_server:app", "--host", "0.0.0.0", "--port", "8000"]
