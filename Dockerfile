# Stage 1: Lấy ffmpeg có hỗ trợ CUDA và đầy đủ codec từ image linuxserver
FROM linuxserver/ffmpeg:latest AS ffmpeg

# Stage 2: Xây dựng image n8n tùy chỉnh dựa trên Ubuntu có CUDA runtime
FROM nvidia/cuda:12.2.0-base-ubuntu22.04
# Cài đặt các gói cần thiết
RUN apt-get update && apt-get install -y \
    curl \
    gnupg2 \
    build-essential \
    wget \
    tar \
    gzip \
    unzip \
    ca-certificates \
    libssl-dev \
    lsb-release \
    apt-transport-https

# Cài đặt Node.js thay vì Bun vì n8n yêu cầu Node.js để chạy đúng cách
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && \
    apt-get install -y nodejs && \
    npm install -g npm && \
    node --version && npm --version

# Cài đặt các gói hỗ trợ Python và tiện ích khác (nếu cần cho n8n hoặc gcloud)
RUN apt-get install -y python3 python3-pip

# Cài đặt Google Cloud CLI theo hướng dẫn chính thức
RUN echo "deb [signed-by=/usr/share/keyrings/cloud.google.gpg] https://packages.cloud.google.com/apt cloud-sdk main" | tee -a /etc/apt/sources.list.d/google-cloud-sdk.list && \
    curl https://packages.cloud.google.com/apt/doc/apt-key.gpg | gpg --dearmor -o /usr/share/keyrings/cloud.google.gpg && \
    apt-get update -y && \
    apt-get install google-cloud-cli -y

# Thiết lập biến môi trường cho gcloud
ENV CLOUDSDK_CONFIG="/home/node/.config/gcloud"

# Cài đặt n8n toàn cục sử dụng npm
RUN npm install -g n8n

# Copy binary ffmpeg từ stage 1
COPY --from=ffmpeg /usr/local/bin/ffmpeg /usr/local/bin/ffmpeg
COPY --from=ffmpeg /usr/local/bin/ffprobe /usr/local/bin/ffprobe

# Tạo thư mục cho thư viện ffmpeg và sao chép thư viện trực tiếp
RUN mkdir -p /usr/local/lib
COPY --from=ffmpeg /usr/local/lib/*.so* /usr/local/lib/
COPY --from=ffmpeg /usr/local/lib/mfx /usr/local/lib/mfx
COPY --from=ffmpeg /usr/local/lib/libmfx-gen /usr/local/lib/libmfx-gen

# Loại bỏ các thư viện có thể xung đột
RUN cd /usr/local/lib && find . -name "libc.so*" -delete

# Thiết lập LD_LIBRARY_PATH để ffmpeg có thể tìm các thư viện cần thiết
ENV LD_LIBRARY_PATH="/usr/local/lib:${LD_LIBRARY_PATH}"

# Tạo user 'node' nếu chưa có, và chuyển sang user này
RUN useradd -m node && mkdir -p /home/node/.n8n && chown -R node:node /home/node

# Đảm bảo n8n có thể được tìm thấy trong PATH cho user node
RUN npm config set prefix /usr/local
ENV PATH="/usr/local/bin:${PATH}"

USER node
WORKDIR /home/node

# Expose port mặc định của n8n (5678)
EXPOSE 5678

# Kiểm tra xem n8n có thể được tìm thấy hay không
RUN which n8n

# Khi chạy container, khởi động n8n
CMD ["n8n"]
