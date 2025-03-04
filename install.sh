#!/bin/bash
# Script cài đặt và thiết lập n8n với Docker và Nginx

# Hàm đợi khóa apt được giải phóng
wait_for_apt() {
  echo "Đang đợi khóa apt được giải phóng..."
  while sudo fuser /var/lib/dpkg/lock-frontend >/dev/null 2>&1 || sudo fuser /var/lib/apt/lists/lock >/dev/null 2>&1 || sudo fuser /var/lib/dpkg/lock >/dev/null 2>&1; do
    echo "Đang đợi tiến trình apt khác kết thúc..."
    sleep 5
  done
  echo "Khóa apt đã được giải phóng, tiếp tục cài đặt..."
}

# Hàm kiểm tra và cài đặt CUDA
check_cuda_installation() {
  echo "Kiểm tra cài đặt CUDA..."
  
  if command -v nvcc &> /dev/null; then
    nvcc_version=$(nvcc --version | grep "release" | awk '{print $6}' | cut -d',' -f1)
    echo "✅ CUDA đã được cài đặt, phiên bản: $nvcc_version"
    
    # Kiểm tra phiên bản CUDA từ nvidia-smi
    if command -v nvidia-smi &> /dev/null; then
      cuda_version=$(nvidia-smi | grep "CUDA Version" | awk '{print $9}')
      echo "✅ CUDA Version từ nvidia-smi: $cuda_version"
      
      # Nếu phiên bản CUDA != 12.2, thực hiện nâng cấp/downgrade
      if [[ "$cuda_version" != "12.2" ]]; then
        echo "⚠️ Phiên bản CUDA hiện tại khác 12.2. Đang cài đặt CUDA 12.2..."
        
        # Tải driver NVIDIA cho CUDA 12.2
        wget https://developer.download.nvidia.com/compute/cuda/12.2.0/local_installers/cuda_12.2.0_535.54.03_linux.run

        # Cấp quyền thực thi
        chmod +x cuda_12.2.0_535.54.03_linux.run

        # Cài đặt driver và CUDA Toolkit
        sudo ./cuda_12.2.0_535.54.03_linux.run
        
        # Thiết lập biến môi trường
        echo 'export PATH=/usr/local/cuda-12.2/bin${PATH:+:${PATH}}' >> ~/.bashrc
        echo 'export LD_LIBRARY_PATH=/usr/local/cuda-12.2/lib64${LD_LIBRARY_PATH:+:${LD_LIBRARY_PATH}}' >> ~/.bashrc
        source ~/.bashrc
        
        echo "✅ Đã cài đặt CUDA 12.2. Vui lòng khởi động lại hệ thống để áp dụng thay đổi."
      fi
    fi
  else
    echo "⚠️ CUDA chưa được cài đặt. Đang cài đặt CUDA 12.2..."
    
    # Tải driver NVIDIA cho CUDA 12.2
    wget https://developer.download.nvidia.com/compute/cuda/12.2.0/local_installers/cuda_12.2.0_535.54.03_linux.run

    # Cấp quyền thực thi
    chmod +x cuda_12.2.0_535.54.03_linux.run

    # Cài đặt driver và CUDA Toolkit
    sudo ./cuda_12.2.0_535.54.03_linux.run
    
    # Thiết lập biến môi trường
    echo 'export PATH=/usr/local/cuda-12.2/bin${PATH:+:${PATH}}' >> ~/.bashrc
    echo 'export LD_LIBRARY_PATH=/usr/local/cuda-12.2/lib64${LD_LIBRARY_PATH:+:${LD_LIBRARY_PATH}}' >> ~/.bashrc
    source ~/.bashrc
    
    # Kiểm tra lại cài đặt
    if command -v nvcc &> /dev/null; then
      nvcc_version=$(nvcc --version | grep "release" | awk '{print $6}' | cut -d',' -f1)
      echo "✅ CUDA đã được cài đặt thành công, phiên bản: $nvcc_version"
    else
      echo "⚠️ Cài đặt CUDA không thành công. Vui lòng cài đặt thủ công."
    fi
  fi
}

# Hàm kiểm tra NVIDIA driver
check_nvidia_driver() {
  echo "Kiểm tra NVIDIA driver..."
  if command -v nvidia-smi &> /dev/null; then
    nvidia_output=$(nvidia-smi 2>&1)
    if echo "$nvidia_output" | grep -q "NVIDIA-SMI has failed"; then
      echo "⚠️ Phát hiện vấn đề với NVIDIA driver. Đang thực hiện khắc phục..."
      
      # Cập nhật package lists
      wait_for_apt && sudo apt-get update -y
      
      # Gỡ bỏ driver cũ nếu có
      wait_for_apt && sudo apt-get remove --purge -y nvidia-*
      
      # Cài đặt các gói cần thiết
      wait_for_apt && sudo apt-get install -y build-essential dkms
      
      # Kiểm tra phiên bản driver được khuyến nghị
      wait_for_apt && sudo apt-get install -y ubuntu-drivers-common
      driver_version=$(ubuntu-drivers devices | grep "recommended" | awk '{print $3}' | cut -d'-' -f2)
      if [ -z "$driver_version" ]; then
        driver_version="535" # Phiên bản driver cho CUDA 12.2
      fi
      
      echo "Đang cài đặt lại NVIDIA driver phiên bản $driver_version..."
      wait_for_apt && sudo apt-get install -y --reinstall nvidia-driver-$driver_version
      
      echo "Kiểm tra và tải kernel module NVIDIA..."
      if ! lsmod | grep -q nvidia; then
        echo "Tải kernel module NVIDIA..."
        sudo modprobe nvidia
      fi
      
      echo "Kiểm tra lại NVIDIA driver..."
      nvidia-smi
      
      echo "⚠️ Nếu vẫn gặp vấn đề với NVIDIA driver, vui lòng khởi động lại hệ thống và chạy lại script."
      echo "Tự động khởi động lại hệ thống để áp dụng thay đổi."
      restart_choice="y"
      if [[ "$restart_choice" == "y" ]]; then
        echo "Hệ thống sẽ khởi động lại sau 5 giây..."
        sleep 5
        sudo reboot
      fi
    else
      echo "✅ NVIDIA driver hoạt động bình thường."
      # Hiển thị thông tin GPU
      echo "Thông tin GPU:"
      nvidia-smi
    fi
  else
    echo "⚠️ Không tìm thấy NVIDIA driver. Đang cài đặt..."
    wait_for_apt && sudo apt-get update -y
    wait_for_apt && sudo apt-get install -y ubuntu-drivers-common
    
    # Tìm driver được khuyến nghị
    driver_version=$(ubuntu-drivers devices | grep "recommended" | awk '{print $3}' | cut -d'-' -f2)
    if [ -z "$driver_version" ]; then
      driver_version="535" # Phiên bản driver cho CUDA 12.2
    fi
    
    echo "Đang cài đặt NVIDIA driver phiên bản $driver_version..."
    wait_for_apt && sudo apt-get install -y nvidia-driver-$driver_version
    
    echo "⚠️ Cần khởi động lại hệ thống để NVIDIA driver có hiệu lực."
    echo "Tự động khởi động lại hệ thống ngay bây giờ."
    restart_choice="y"
    if [[ "$restart_choice" == "y" ]]; then
      echo "Hệ thống sẽ khởi động lại sau 5 giây..."
      sleep 5
      sudo reboot
    else
      echo "⚠️ Vui lòng khởi động lại hệ thống sau khi cài đặt hoàn tất để NVIDIA driver có hiệu lực."
    fi
  fi
}

# Hàm kiểm tra GPU cho Docker
verify_gpu_for_docker() {
  echo "Kiểm tra GPU cho Docker..."
  
  # Kiểm tra xem Docker có thể truy cập GPU không
  if sudo docker run --rm --gpus all nvidia/cuda:12.2.0-base-ubuntu20.04 nvidia-smi &> /dev/null; then
    echo "✅ Docker có thể truy cập GPU thành công."
    # Hiển thị thông tin GPU từ container
    sudo docker run --rm --gpus all nvidia/cuda:12.2.0-base-ubuntu20.04 nvidia-smi
  else
    echo "⚠️ Docker không thể truy cập GPU. Đang cấu hình lại NVIDIA Container Toolkit..."
    
    # Cài đặt lại NVIDIA Container Toolkit
    curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
    curl -s -L https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list \
    | sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' \
    | sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list
    
    wait_for_apt && sudo apt-get update -y
    wait_for_apt && sudo apt-get install -y nvidia-container-toolkit
    
    # Cấu hình Docker để sử dụng NVIDIA runtime
    sudo nvidia-ctk runtime configure --runtime=docker
    sudo systemctl restart docker
    
    # Kiểm tra lại
    if sudo docker run --rm --gpus all nvidia/cuda:12.2.0-base-ubuntu20.04 nvidia-smi &> /dev/null; then
      echo "✅ Docker đã có thể truy cập GPU thành công."
      sudo docker run --rm --gpus all nvidia/cuda:12.2.0-base-ubuntu20.04 nvidia-smi
    else
      echo "⚠️ Docker vẫn không thể truy cập GPU. Vui lòng kiểm tra lại cài đặt thủ công."
    fi
  fi
}

# Hàm dọn dẹp thư mục và file tạm
cleanup_temp_files() {
  echo "Đang dọn dẹp thư mục và file tạm..."
  
  # Xóa các file tạm và cache apt
  sudo apt-get clean -y
  sudo apt-get autoremove -y
  
  # Xóa các file tạm trong /tmp
  sudo rm -rf /tmp/*
  
  # Xóa cache Docker nếu cần
  echo "Tự động xóa cache Docker."
  clean_docker="y"
  if [[ "$clean_docker" == "y" ]]; then
    echo "Đang xóa cache Docker..."
    sudo docker system prune -af --volumes
  fi
  
  # Xóa các file log cũ
  sudo find /var/log -type f -name "*.gz" -delete
  sudo find /var/log -type f -name "*.1" -delete
  
  # Xóa các file .bak và .tmp
  sudo find ~ -type f -name "*.bak" -delete
  sudo find ~ -type f -name "*.tmp" -delete
  
  echo "Dọn dẹp hoàn tất!"
}

echo "--------- 🟢 Bắt đầu clone repository -----------"
git clone https://github.com/thanhnn16/MIAI_n8n_dockercompose.git
mv MIAI_n8n_dockercompose n8n
cd n8n
cp .env.example .env
echo "--------- 🔴 Hoàn thành clone repository -----------"

echo "--------- 🟢 Bắt đầu cài đặt Docker -----------"
wait_for_apt && sudo apt update -y
wait_for_apt && sudo apt install -y apt-transport-https ca-certificates curl software-properties-common
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo apt-key add -
sudo add-apt-repository -y "deb [arch=amd64] https://download.docker.com/linux/ubuntu focal stable"
apt-cache policy docker-ce
wait_for_apt && sudo apt install -y docker-ce
echo "--------- 🔴 Hoàn thành cài đặt Docker -----------"

echo "--------- 🟢 Bắt đầu cài đặt Docker Compose -----------"
sudo curl -L "https://github.com/docker/compose/releases/download/v2.20.3/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose
echo "--------- 🔴 Hoàn thành cài đặt Docker Compose -----------"

echo "--------- 🟢 Kiểm tra và cài đặt NVIDIA driver -----------"
check_nvidia_driver
echo "--------- 🔴 Hoàn thành kiểm tra NVIDIA driver -----------"

echo "--------- 🟢 Kiểm tra và cài đặt CUDA -----------"
check_cuda_installation
echo "--------- 🔴 Hoàn thành kiểm tra CUDA -----------"

echo "--------- 🟢 Bắt đầu cài đặt NVIDIA support cho Docker -----------"
curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey \
| sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
curl -s -L https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list \
| sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' \
| sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list
wait_for_apt && sudo apt-get update -y
wait_for_apt && sudo apt-get install -y nvidia-container-toolkit
sudo nvidia-ctk runtime configure --runtime=docker
sudo systemctl restart docker
echo "--------- 🔴 Hoàn thành cài đặt NVIDIA support cho Docker -----------"

echo "--------- 🟢 Kiểm tra GPU cho Docker -----------"
verify_gpu_for_docker
echo "--------- 🔴 Hoàn thành kiểm tra GPU cho Docker -----------"

echo "--------- 🟢 Bắt đầu cài đặt Nginx -----------"
wait_for_apt && sudo apt update -y
wait_for_apt && sudo apt install -y nginx
echo "--------- 🔴 Hoàn thành cài đặt Nginx -----------"

echo "--------- 🟢 Bắt đầu cài đặt Snap -----------"
wait_for_apt && sudo apt install -y snapd
echo "--------- 🔴 Hoàn thành cài đặt Snap -----------"

echo "--------- 🟢 Bắt đầu cấu hình Nginx cho n8n -----------"
# Kiểm tra xem thư mục nginx/n8n có tồn tại không
if [ -d "./nginx/n8n" ]; then
    # Copy file cấu hình từ thư mục nginx/n8n vào /etc/nginx/sites-available
    sudo cp ./nginx/n8n /etc/nginx/sites-available/n8n
    # Tạo symbolic link từ sites-available đến sites-enabled
    sudo ln -sf /etc/nginx/sites-available/n8n /etc/nginx/sites-enabled/
    # Kiểm tra cấu hình nginx
    sudo nginx -t
    # Khởi động lại nginx
    sudo systemctl restart nginx
else
    echo "Thư mục nginx/n8n không tồn tại, tạo file cấu hình Nginx mặc định cho n8n"
    cat > ./n8n_nginx_config << 'EOL'
server {
    listen 80;
    server_name n8n.autoreel.io.vn;

    location / {
        proxy_pass http://localhost:5678;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
EOL
    sudo cp ./n8n_nginx_config /etc/nginx/sites-available/n8n
    sudo ln -sf /etc/nginx/sites-available/n8n /etc/nginx/sites-enabled/
    sudo nginx -t
    sudo systemctl restart nginx
    # Xóa file tạm
    rm ./n8n_nginx_config
fi
echo "--------- 🔴 Hoàn thành cấu hình Nginx cho n8n -----------"

echo "--------- 🟢 Bắt đầu cài đặt Certbot -----------"
sudo snap install --classic certbot
sudo ln -sf /snap/bin/certbot /usr/bin/certbot
echo "--------- 🔴 Hoàn thành cài đặt Certbot -----------"

echo "--------- 🟢 Bắt đầu thiết lập SSL với Certbot -----------"
# Chạy certbot để lấy chứng chỉ SSL, chế độ tự động
sudo certbot --nginx --non-interactive --agree-tos --redirect \
    --staple-ocsp --email admin@autoreel.io.vn -d n8n.autoreel.io.vn
echo "--------- 🔴 Hoàn thành thiết lập SSL với Certbot -----------"

echo "--------- 🟢 Bắt đầu build Docker Compose -----------"
cd ~/n8n

echo "Tạo thư mục storage cho ComfyUI..."
mkdir -p storage
chmod 777 storage

echo "Đang build các container..."
sudo docker-compose build
echo "Build hoàn tất!"
echo "--------- 🔴 Hoàn thành build Docker Compose -----------"

echo "--------- 🟢 Khởi động n8n với Docker Compose -----------"
echo "Đang khởi động các container..."
sudo docker-compose up -d
echo "Các container đã được khởi động thành công!"
echo "--------- 🔴 n8n đã được khởi động -----------"

echo "--------- 🟢 Bắt đầu tải Flux1 Checkpoint -----------"
echo "Tạo thư mục cho Flux1 Checkpoint..."
mkdir -p ~/n8n/storage/ComfyUI/models/checkpoints/FLUX1

# Đường dẫn đến file Flux1 Checkpoint
FLUX1_FILE=~/n8n/storage/ComfyUI/models/checkpoints/FLUX1/flux1-dev-fp8.safetensors

# Kiểm tra xem file đã tồn tại chưa
if [ -f "$FLUX1_FILE" ]; then
    echo "File Flux1-dev-fp8 Checkpoint đã tồn tại. Bỏ qua bước tải..."
else
    echo "Đang tải Flux1-dev-fp8 Checkpoint..."
    wget -O "$FLUX1_FILE" https://huggingface.co/Comfy-Org/flux1-dev/resolve/main/flux1-dev-fp8.safetensors
    
    # Kiểm tra xem tải thành công không
    if [ -f "$FLUX1_FILE" ]; then
        echo "Tải Flux1-dev-fp8 Checkpoint thành công!"
    else
        echo "⚠️ Tải Flux1-dev-fp8 Checkpoint không thành công. Vui lòng tải thủ công sau."
    fi
fi

echo "Đặt quyền cho thư mục và file..."
chmod -R 777 ~/n8n/storage/ComfyUI/models
echo "--------- 🔴 Hoàn thành tải Flux1 Checkpoint -----------"

echo "--------- 🟢 Dọn dẹp các file tạm và thư mục dư thừa -----------"
cleanup_temp_files
echo "--------- 🔴 Hoàn thành dọn dẹp -----------"

echo "Cài đặt hoàn tất! Truy cập n8n tại https://n8n.autoreel.io.vn"
echo ""
echo "Thông tin hệ thống:"
echo "- Docker version: $(docker --version)"
echo "- Docker Compose version: $(docker-compose --version)"
echo "- NVIDIA Driver version: $(nvidia-smi | grep "Driver Version" | awk '{print $3}')"
if command -v nvcc &> /dev/null; then
  echo "- CUDA version: $(nvcc --version | grep "release" | awk '{print $6}' | cut -d',' -f1)"
fi
echo ""
echo "Nếu bạn gặp vấn đề với NVIDIA driver, vui lòng thử các bước sau:"
echo "1. Khởi động lại hệ thống: sudo reboot"
echo "2. Sau khi khởi động lại, kiểm tra trạng thái driver: nvidia-smi"
echo "3. Nếu vẫn gặp vấn đề, chạy lại script này hoặc cài đặt thủ công driver NVIDIA"

