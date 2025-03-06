FROM linuxserver/ffmpeg:latest

USER root

# Cập nhật package list và cài đặt Node.js cùng npm (dành cho Debian/Ubuntu)
RUN apt-get update && \
    apt-get install -y nodejs npm && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy file package.json và cài đặt các dependency
COPY package.json .
RUN npm install

# Copy mã nguồn server
COPY server.js .

# Expose port cho HTTP server
EXPOSE 3000

# Chạy server
CMD ["node", "server.js"]
