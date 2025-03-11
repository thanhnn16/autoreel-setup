FROM linuxserver/ffmpeg:latest

USER root

# Install curl and unzip for Bun installation
RUN apt-get update && \
    apt-get install -y curl unzip fontconfig && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Install Bun
RUN curl -fsSL https://bun.sh/install | bash

# Add Bun to PATH
ENV PATH="/root/.bun/bin:${PATH}"

WORKDIR /app

# Cài đặt font hỗ trợ Unicode đầy đủ
RUN apt-get update && apt-get install -y fonts-noto fonts-noto-cjk fonts-noto-color-emoji && rm -rf /var/lib/apt/lists/*

# Sao chép font từ thư mục /fonts vào hệ thống
RUN mkdir -p /usr/share/fonts/truetype/custom
COPY ./fonts/Montserrat/*.ttf /usr/share/fonts/truetype/custom/
COPY ./fonts/Bungee_Spice/*.ttf /usr/share/fonts/truetype/custom/
COPY ./fonts/Poppins/*.ttf /usr/share/fonts/truetype/custom/
COPY ./fonts/Quicksand/*.ttf /usr/share/fonts/truetype/custom/
RUN fc-cache -f -v

# Override the base image's ENTRYPOINT
ENTRYPOINT []

# Copy package.json and bun.lock, then install dependencies
COPY package.json bun.lock ./
RUN bun install

# Copy source code
COPY src/ ./src/

# Expose port for HTTP server
EXPOSE 3000

# Start the server
CMD ["bun", "src/app.js"]
