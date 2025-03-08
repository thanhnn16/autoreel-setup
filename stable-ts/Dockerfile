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

# Cấu hình PyTorch để tối ưu bộ nhớ
ENV PYTORCH_CUDA_ALLOC_CONF="expandable_segments:True"

# Tạo thư mục cho mô hình
RUN mkdir -p /app/models/vinai/PhoWhisper-large

# Tải mô hình PhoWhisper-large từ Hugging Face
RUN python3 -c "from huggingface_hub import snapshot_download; snapshot_download(repo_id='vinai/PhoWhisper-large', local_dir='/app/models/vinai/PhoWhisper-large', local_dir_use_symlinks=False)"

# Copy mã nguồn FastAPI (api_server.py) vào image
COPY api_server.py .

# Mở cổng 8000 để cho phép truy cập API từ bên ngoài container
EXPOSE 8000

# CMD khởi chạy uvicorn để phục vụ API
CMD ["uvicorn", "api_server:app", "--host", "0.0.0.0", "--port", "8000"]
