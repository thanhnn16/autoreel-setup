FROM python:3.12-slim

# Cài đặt các phụ thuộc hệ thống cần thiết cho xử lý audio và phụ đề
RUN apt-get update && apt-get install -y \
    ffmpeg \
    libass-dev \
    libfontconfig1-dev \
    libfreetype6-dev \
    libfribidi-dev \
    libharfbuzz-dev \
    curl \
    build-essential \
    git && rm -rf /var/lib/apt/lists/*

# Thiết lập thư mục làm việc
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

# Copy requirements.txt và cài đặt stable-ts cùng các thư viện liên quan
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy toàn bộ mã nguồn ứng dụng vào container
COPY . .

# Tạo các thư mục cần thiết
RUN mkdir -p temp outputs

# Expose port của FastAPI app
EXPOSE 8000

# Khởi chạy ứng dụng FastAPI
CMD ["uvicorn", "api_server:app", "--host", "0.0.0.0", "--port", "8000"]
