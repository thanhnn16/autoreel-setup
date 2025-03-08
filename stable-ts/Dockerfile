# Sử dụng CUDA 12.2.0-base-ubuntu22.04 làm image nền
FROM nvidia/cuda:12.2.0-base-ubuntu22.04

# Cài đặt các dependency hệ thống: ffmpeg, python3, pip
RUN apt-get update && apt-get install -y \
    ffmpeg \
    python3 \
    python3-pip \
    libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

# Thiết lập thư mục làm việc
WORKDIR /app

# Cài đặt các package Python cần thiết:
RUN pip3 install --no-cache-dir uvicorn fastapi
RUN pip3 install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cu124
RUN pip3 install --no-cache-dir git+https://github.com/jianfch/stable-ts.git
RUN pip3 install --no-cache-dir python-multipart
RUN pip3 install --no-cache-dir pydub

# Cấu hình PyTorch để tối ưu bộ nhớ
ENV PYTORCH_CUDA_ALLOC_CONF="expandable_segments:True"

# Copy mã nguồn FastAPI (api_server.py) vào image
COPY api_server.py .

# Mở cổng 8000 để cho phép truy cập API từ bên ngoài container
EXPOSE 8000

# Khởi chạy API server
CMD ["uvicorn", "api_server:app", "--host", "0.0.0.0", "--port", "8000"]
