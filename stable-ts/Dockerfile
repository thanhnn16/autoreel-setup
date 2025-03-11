FROM python:3.12-slim

# Cài đặt các phụ thuộc hệ thống
RUN apt-get update && apt-get install -y \
    git \
    build-essential \
    cmake \
    libboost-all-dev \
    libicu-dev \
    ninja-build \
    pkg-config \
    ffmpeg \
    libass-dev \
    libfontconfig1-dev \
    libfreetype6-dev \
    libfribidi-dev \
    libharfbuzz-dev \
    meson \
    curl \
    libiconv-hook-dev \
    libintl-perl \
    zlib1g-dev \
    wx3.2-headers \
    libwxgtk3.2-dev \
    libreadline-dev \
    libluajit-5.1-dev && rm -rf /var/lib/apt/lists/*

# Thiết lập thư mục làm việc
WORKDIR /app

# Clone và build aegisub-cli
RUN git clone https://github.com/Myaamori/aegisub-cli.git && \
    cd aegisub-cli && \
    meson --prefix=/usr --buildtype=release -Dsystem_luajit=true builddir && \
    ninja -C builddir src/aegisub-cli && \
    cp builddir/src/aegisub-cli /usr/local/bin/ && \
    cd .. && rm -rf aegisub-cli

# Cài đặt automation scripts (DependencyControl & ILL)
RUN mkdir -p /root/.aegisub/automation/autoload && \
    git clone https://github.com/TypesettingTools/DependencyControl.git /root/.aegisub/automation/autoload/DependencyControl && \
    git clone https://github.com/TypesettingTools/ILL.git /root/.aegisub/automation/autoload/ILL

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
