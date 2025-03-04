# Stage 1: Lấy ffmpeg có hỗ trợ CUDA và đầy đủ codec từ image jrottenberg
FROM jrottenberg/ffmpeg:7.1-nvidia AS ffmpeg

# Stage 2: Xây dựng image n8n tùy chỉnh dựa trên Ubuntu có CUDA runtime
FROM nvidia/cuda:12.6.0-base-ubuntu20.04
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

# Cài đặt Bun thay vì Node.js
RUN curl -fsSL https://bun.sh/install | bash && \
    echo 'export BUN_INSTALL="$HOME/.bun"' >> /root/.bashrc && \
    echo 'export PATH="$BUN_INSTALL/bin:$PATH"' >> /root/.bashrc && \
    . /root/.bashrc && \
    /root/.bun/bin/bun --version

# Thiết lập PATH để sử dụng Bun
ENV PATH="/root/.bun/bin:${PATH}"

# Cài đặt các gói hỗ trợ Python và tiện ích khác (nếu cần cho n8n hoặc gcloud)
RUN apt-get install -y python3 python3-pip

# Cài đặt Google Cloud CLI theo hướng dẫn chính thức
RUN echo "deb [signed-by=/usr/share/keyrings/cloud.google.gpg] https://packages.cloud.google.com/apt cloud-sdk main" | tee -a /etc/apt/sources.list.d/google-cloud-sdk.list && \
    curl https://packages.cloud.google.com/apt/doc/apt-key.gpg | gpg --dearmor -o /usr/share/keyrings/cloud.google.gpg && \
    apt-get update -y && \
    apt-get install google-cloud-cli -y

# Thiết lập biến môi trường cho gcloud
ENV CLOUDSDK_CONFIG="/home/node/.config/gcloud"

# Cài đặt n8n toàn cục sử dụng Bun
RUN bun install -g n8n

# Copy binary ffmpeg từ stage 1
COPY --from=ffmpeg /usr/local/bin/ffmpeg /usr/local/bin/ffmpeg

# Copy các thư viện ffmpeg cần thiết, nhưng loại trừ libc.so.6 để tránh xung đột
RUN mkdir -p /usr/local/lib/ffmpeg
COPY --from=ffmpeg /usr/local/lib/ /tmp/ffmpeg_libs/
RUN cd /tmp/ffmpeg_libs && \
    find . -type f -name "*.so*" ! -name "libc.so*" -exec cp --parents {} /usr/local/lib/ \; && \
    rm -rf /tmp/ffmpeg_libs

# Thiết lập LD_LIBRARY_PATH để ffmpeg có thể tìm các thư viện cần thiết
ENV LD_LIBRARY_PATH="/usr/local/lib:${LD_LIBRARY_PATH}"

# Tạo user 'node' nếu chưa có, và chuyển sang user này
RUN useradd -m node && mkdir -p /home/node/.n8n && chown -R node:node /home/node && \
    mkdir -p /root/.bun && cp -r /root/.bun /home/node/ && chown -R node:node /home/node/.bun

# Thiết lập PATH cho user node
ENV PATH="/home/node/.bun/bin:${PATH}"
USER node
WORKDIR /home/node

# Expose port mặc định của n8n (5678)
EXPOSE 5678

# Khi chạy container, khởi động n8n
CMD ["n8n"]
