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
  
  # Kiểm tra trạng thái CUDA từ nvidia-smi trước
  if command -v nvidia-smi &> /dev/null; then
    cuda_version=$(nvidia-smi | grep "CUDA Version" | awk '{print $9}')
    if [[ -n "$cuda_version" ]]; then
      echo "✅ CUDA Runtime đã được cài đặt, phiên bản: $cuda_version (từ nvidia-smi)"
      
      # Nếu phiên bản CUDA từ nvidia-smi đã là 12.6, không cần tiếp tục
      if [[ "$cuda_version" == "12.6" ]]; then
        echo "✅ CUDA Runtime phiên bản 12.6 đã được cài đặt. Không cần cài đặt lại."
        return 0
      fi
    fi
  fi
  
  # Kiểm tra nvcc (CUDA compiler)
  if command -v nvcc &> /dev/null; then
    nvcc_version=$(nvcc --version | grep "release" | awk '{print $6}' | cut -d',' -f1)
    echo "✅ CUDA Toolkit đã được cài đặt, phiên bản: $nvcc_version (từ nvcc)"
    
    # Nếu phiên bản CUDA từ nvcc cũng khác 12.6 thì mới thực hiện nâng cấp/downgrade
    if [[ "$nvcc_version" != "12.6" ]]; then
      echo "⚠️ Phiên bản CUDA Toolkit hiện tại khác 12.6. Đang cài đặt CUDA 12.6.3..."
      install_cuda_12_6_3
    else
      echo "✅ CUDA Toolkit phiên bản 12.6 đã được cài đặt. Không cần cài đặt lại."
    fi
  else
    # Nếu đã có CUDA Runtime 12.6 từ nvidia-smi nhưng không có nvcc
    if [[ "$cuda_version" == "12.6" ]]; then
      echo "⚠️ CUDA Runtime 12.6 đã cài đặt nhưng không tìm thấy CUDA Toolkit (nvcc)."
      # Tự động cài đặt CUDA Toolkit mà không hỏi người dùng
      echo "Tự động cài đặt đầy đủ CUDA Toolkit..."
      install_cuda_12_6_3
    else
      echo "⚠️ CUDA chưa được cài đặt đầy đủ. Đang cài đặt CUDA 12.6.3..."
      install_cuda_12_6_3
    fi
  fi
}

# Hàm riêng để cài đặt CUDA 12.6.3
install_cuda_12_6_3() {
  # Chuẩn bị hệ thống
  wait_for_apt && sudo DEBIAN_FRONTEND=noninteractive apt-get update -y
  wait_for_apt && sudo DEBIAN_FRONTEND=noninteractive apt-get install -y build-essential linux-headers-$(uname -r)
  
  # Xóa cài đặt CUDA cũ nếu có
  echo "Xóa cài đặt CUDA cũ nếu có..."
  wait_for_apt && sudo DEBIAN_FRONTEND=noninteractive apt-get purge -y cuda* --autoremove
  sudo rm -rf /usr/local/cuda*
  
  # Tải installer CUDA 12.6.3
  echo "Tải CUDA 12.6.3 installer..."
  wget -q --show-progress https://developer.download.nvidia.com/compute/cuda/12.6.3/local_installers/cuda_12.6.3_560.35.05_linux.run
  
  # Cấp quyền thực thi
  chmod +x cuda_12.6.3_560.35.05_linux.run

  # Cài đặt CUDA Toolkit (không cài driver vì đã cài riêng)
  echo "Cài đặt CUDA 12.6.3 Toolkit..."
  sudo ./cuda_12.6.3_560.35.05_linux.run --silent --toolkit --samples --no-opengl-libs --override
  
  # Thiết lập biến môi trường
  echo 'export PATH=/usr/local/cuda-12.6/bin${PATH:+:${PATH}}' >> ~/.bashrc
  echo 'export LD_LIBRARY_PATH=/usr/local/cuda-12.6/lib64${LD_LIBRARY_PATH:+:${LD_LIBRARY_PATH}}' >> ~/.bashrc
  source ~/.bashrc
  
  # Cập nhật PATH cho toàn hệ thống
  echo "/usr/local/cuda-12.6/lib64" | sudo tee /etc/ld.so.conf.d/cuda.conf
  sudo ldconfig
  
  # Kiểm tra lại cài đặt
  if command -v nvcc &> /dev/null; then
    nvcc_version=$(nvcc --version | grep "release" | awk '{print $6}' | cut -d',' -f1)
    echo "✅ CUDA đã được cài đặt thành công, phiên bản: $nvcc_version"
    
    # Kiểm tra chi tiết hơn với deviceQuery
    echo "Cài đặt các gói phụ thuộc cho CUDA samples..."
    wait_for_apt && sudo DEBIAN_FRONTEND=noninteractive apt-get install -y freeglut3-dev libx11-dev libxi-dev libxmu-dev libglu1-mesa-dev
    
    if [ -d "/usr/local/cuda-12.6/samples/1_Utilities/deviceQuery" ]; then
      echo "Xác minh cài đặt CUDA với deviceQuery..."
      cd /usr/local/cuda-12.6/samples/1_Utilities/deviceQuery
      sudo make > /dev/null 2>&1
      ./deviceQuery
    fi
  else
    echo "⚠️ Cài đặt CUDA không thành công. Vui lòng cài đặt thủ công."
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
      wait_for_apt && sudo DEBIAN_FRONTEND=noninteractive apt-get update -y
      
      # Gỡ bỏ driver cũ nếu có
      wait_for_apt && sudo DEBIAN_FRONTEND=noninteractive apt-get remove --purge -y nvidia-*
      
      # Cài đặt các gói cần thiết
      wait_for_apt && sudo DEBIAN_FRONTEND=noninteractive apt-get install -y build-essential dkms
      
      # Cài đặt Driver NVIDIA mới nhất
      wait_for_apt && sudo DEBIAN_FRONTEND=noninteractive apt-get install -y ubuntu-drivers-common
      
      echo "Đang cài đặt NVIDIA driver phiên bản mới nhất..."
      wait_for_apt && sudo DEBIAN_FRONTEND=noninteractive ubuntu-drivers autoinstall
      
      # Thêm blacklist cho Nouveau driver nếu cần
      echo "blacklist nouveau" | sudo tee /etc/modprobe.d/blacklist-nouveau.conf
      sudo update-initramfs -u
      
      echo "Kiểm tra và tải kernel module NVIDIA..."
      if ! lsmod | grep -q nvidia; then
        echo "Tải kernel module NVIDIA..."
        sudo modprobe nvidia
      fi
      
      echo "Kiểm tra lại NVIDIA driver..."
      nvidia-smi
      
      echo "⚠️ Nếu vẫn gặp vấn đề với NVIDIA driver, vui lòng khởi động lại hệ thống và chạy lại script."
      echo "Tự động khởi động lại hệ thống để áp dụng thay đổi."
      # Không hỏi người dùng, tự động reboot
      echo "Hệ thống sẽ khởi động lại sau 5 giây..."
      sleep 5
      sudo reboot
    else
      echo "✅ NVIDIA driver hoạt động bình thường."
      # Hiển thị thông tin GPU
      echo "Thông tin GPU:"
      nvidia-smi
    fi
  else
    echo "⚠️ Không tìm thấy NVIDIA driver. Đang cài đặt..."
    wait_for_apt && sudo DEBIAN_FRONTEND=noninteractive apt-get update -y
    wait_for_apt && sudo DEBIAN_FRONTEND=noninteractive apt-get install -y ubuntu-drivers-common
    
    echo "Đang cài đặt NVIDIA driver phiên bản mới nhất..."
    wait_for_apt && sudo DEBIAN_FRONTEND=noninteractive ubuntu-drivers autoinstall
    
    # Thêm blacklist cho Nouveau driver
    echo "blacklist nouveau" | sudo tee /etc/modprobe.d/blacklist-nouveau.conf
    sudo update-initramfs -u
    
    echo "⚠️ Cần khởi động lại hệ thống để NVIDIA driver có hiệu lực."
    echo "Tự động khởi động lại hệ thống ngay bây giờ."
    # Tự động reboot không hỏi người dùng
    echo "Hệ thống sẽ khởi động lại sau 5 giây..."
    sleep 5
    sudo reboot
  fi
}

# Hàm kiểm tra GPU cho Docker
verify_gpu_for_docker() {
  echo "Kiểm tra GPU cho Docker..."
  
  # Kiểm tra xem Docker có thể truy cập GPU không
  if sudo docker run --rm --gpus all nvidia/cuda:12.6.0-base-ubuntu20.04 nvidia-smi &> /dev/null; then
    echo "✅ Docker có thể truy cập GPU thành công."
    # Hiển thị thông tin GPU từ container
    sudo docker run --rm --gpus all nvidia/cuda:12.6.0-base-ubuntu20.04 nvidia-smi
  else
    echo "⚠️ Docker không thể truy cập GPU. Đang cấu hình lại NVIDIA Container Toolkit..."
    
    # Cài đặt lại NVIDIA Container Toolkit
    curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
    curl -s -L https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list \
    | sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' \
    | sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list
    
    wait_for_apt && sudo DEBIAN_FRONTEND=noninteractive apt-get update -y
    wait_for_apt && sudo DEBIAN_FRONTEND=noninteractive apt-get install -y nvidia-container-toolkit
    
    # Cấu hình Docker để sử dụng NVIDIA runtime
    sudo nvidia-ctk runtime configure --runtime=docker
    sudo systemctl restart docker
    
    # Kiểm tra lại
    if sudo docker run --rm --gpus all nvidia/cuda:12.6.0-base-ubuntu20.04 nvidia-smi &> /dev/null; then
      echo "✅ Docker đã có thể truy cập GPU thành công."
      sudo docker run --rm --gpus all nvidia/cuda:12.6.0-base-ubuntu20.04 nvidia-smi
    else
      echo "⚠️ Docker vẫn không thể truy cập GPU. Vui lòng kiểm tra lại cài đặt thủ công."
    fi
  fi
}

# Hàm dọn dẹp thư mục và file tạm
cleanup_temp_files() {
  echo "Đang dọn dẹp thư mục và file tạm..."
  
  # Xóa các file tạm và cache apt
  sudo DEBIAN_FRONTEND=noninteractive apt-get clean -y
  sudo DEBIAN_FRONTEND=noninteractive apt-get autoremove -y
  
  # Xóa các file tạm trong /tmp
  sudo rm -rf /tmp/*
  
  # Xóa cache Docker
  echo "Tự động xóa cache Docker."
  # Không hỏi người dùng, tự động xóa cache
  echo "Đang xóa cache Docker..."
  sudo docker system prune -af --volumes
  
  # Xóa các file log cũ
  sudo find /var/log -type f -name "*.gz" -delete
  sudo find /var/log -type f -name "*.1" -delete
  
  # Xóa các file .bak và .tmp
  sudo find ~ -type f -name "*.bak" -delete
  sudo find ~ -type f -name "*.tmp" -delete
  
  echo "Dọn dẹp hoàn tất!"
}

echo "--------- 🟢 Bắt đầu clone repository -----------"
git clone https://github.com/thanhnn16/autoreel-setup.git --quiet
mv autoreel-setup n8n
cd n8n
cp .env.example .env
echo "--------- 🔴 Hoàn thành clone repository -----------"

echo "--------- 🟢 Bắt đầu cài đặt Docker -----------"
wait_for_apt && sudo DEBIAN_FRONTEND=noninteractive apt update -y
wait_for_apt && sudo DEBIAN_FRONTEND=noninteractive apt install -y apt-transport-https ca-certificates curl software-properties-common
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo apt-key add -
sudo add-apt-repository -y "deb [arch=amd64] https://download.docker.com/linux/ubuntu focal stable"
apt-cache policy docker-ce
wait_for_apt && sudo DEBIAN_FRONTEND=noninteractive apt install -y docker-ce
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
wait_for_apt && sudo DEBIAN_FRONTEND=noninteractive apt-get update -y
wait_for_apt && sudo DEBIAN_FRONTEND=noninteractive apt-get install -y nvidia-container-toolkit
sudo nvidia-ctk runtime configure --runtime=docker
sudo systemctl restart docker
echo "--------- 🔴 Hoàn thành cài đặt NVIDIA support cho Docker -----------"

echo "--------- 🟢 Kiểm tra GPU cho Docker -----------"
verify_gpu_for_docker
echo "--------- 🔴 Hoàn thành kiểm tra GPU cho Docker -----------"

echo "--------- 🟢 Bắt đầu cài đặt Nginx -----------"
wait_for_apt && sudo DEBIAN_FRONTEND=noninteractive apt update -y
wait_for_apt && sudo DEBIAN_FRONTEND=noninteractive apt install -y nginx
echo "--------- 🔴 Hoàn thành cài đặt Nginx -----------"

echo "--------- 🟢 Bắt đầu cài đặt Snap -----------"
wait_for_apt && sudo DEBIAN_FRONTEND=noninteractive apt install -y snapd
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
sudo snap install --classic certbot --quiet
sudo ln -sf /snap/bin/certbot /usr/bin/certbot
echo "--------- 🔴 Hoàn thành cài đặt Certbot -----------"

echo "--------- 🟢 Bắt đầu thiết lập SSL với Certbot -----------"
# Chạy certbot để lấy chứng chỉ SSL, chế độ tự động và không tương tác
sudo certbot --nginx --non-interactive --agree-tos --redirect \
    --staple-ocsp --email admin@autoreel.io.vn -d n8n.autoreel.io.vn \
    --quiet
echo "--------- 🔴 Hoàn thành thiết lập SSL với Certbot -----------"

echo "--------- 🟢 Bắt đầu build Docker Compose -----------"
cd ~/n8n

echo "Tạo thư mục storage cho ComfyUI..."
mkdir -p storage
chmod 777 storage

echo "Đang build các container..."
# Xóa output của lệnh build để không hiển thị quá nhiều thông tin
sudo docker-compose build --quiet
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
    # Thêm -q để chế độ yên lặng với thanh tiến trình đơn giản
    wget -q --show-progress -O "$FLUX1_FILE" https://huggingface.co/Comfy-Org/flux1-dev/resolve/main/flux1-dev-fp8.safetensors
    
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

echo "--------- 🟢 Bắt đầu tải Wan2.1 và Flux Models -----------"

# Tạo cấu trúc thư mục cho Wan2.1
mkdir -p ~/n8n/storage/ComfyUI/models/{text_encoders,vae,diffusion_models,clip_vision}

# Hàm kiểm tra và tải model
download_model() {
  local url=$1
  local dest=$2
  local filename=$(basename "$dest")
  
  if [ -f "$dest" ]; then
    echo "✅ $filename đã tồn tại. Bỏ qua..."
  else
    echo "🔄 Đang tải $filename..."
    wget -q --show-progress -O "$dest" "$url"
    
    if [ -f "$dest" ]; then
      echo "✅ Tải $filename thành công!"
    else
      echo "❌ Lỗi khi tải $filename"
    fi
  fi
}

# Tải các model Wan2.1
echo "Đang tải các model Wan2.1..."
download_model "https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors" \
  "~/n8n/storage/ComfyUI/models/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors"

download_model "https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/vae/wan_2.1_vae.safetensors" \
  "~/n8n/storage/ComfyUI/models/vae/wan_2.1_vae.safetensors"

download_model "https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/diffusion_models/wan2.1_t2v_1.3B_bf16.safetensors" \
  "~/n8n/storage/ComfyUI/models/diffusion_models/wan2.1_t2v_1.3B_bf16.safetensors"

# Cấp quyền cho thư mục models
chmod -R 777 ~/n8n/storage/ComfyUI/models

echo "--------- 🔴 Hoàn thành tải model -----------"

echo "--------- 🟢 Bắt đầu cập nhật ComfyUI và cài đặt node mới -----------"
# Vào thư mục ComfyUI trong container để cập nhật
echo "Bắt đầu cập nhật ComfyUI..."
COMFYUI_CONTAINER=$(sudo docker ps | grep comfyui | awk '{print $1}')

if [ -n "$COMFYUI_CONTAINER" ]; then
    echo "✅ Tìm thấy container ComfyUI: $COMFYUI_CONTAINER"
    # Cập nhật ComfyUI từ GitHub
    sudo docker exec $COMFYUI_CONTAINER bash -c "cd /ComfyUI && git pull"
    echo "✅ Đã cập nhật ComfyUI lên phiên bản mới nhất"
    
    # Cài đặt node ComfyUI-GGUF nếu chưa có
    if [ ! -d "~/n8n/storage/ComfyUI/custom_nodes/ComfyUI-GGUF" ]; then
        echo "🔄 Đang cài đặt ComfyUI-GGUF..."
        sudo docker exec $COMFYUI_CONTAINER bash -c "cd /ComfyUI/custom_nodes && git clone https://github.com/city96/ComfyUI-GGUF.git"
        echo "✅ Đã cài đặt ComfyUI-GGUF"
    else
        echo "✅ ComfyUI-GGUF đã được cài đặt. Cập nhật repository..."
        sudo docker exec $COMFYUI_CONTAINER bash -c "cd /ComfyUI/custom_nodes/ComfyUI-GGUF && git pull"
    fi
    
    # Cài đặt node ComfyUI-VideoHelperSuite nếu chưa có
    if [ ! -d "~/n8n/storage/ComfyUI/custom_nodes/ComfyUI-VideoHelperSuite" ]; then
        echo "🔄 Đang cài đặt ComfyUI-VideoHelperSuite..."
        sudo docker exec $COMFYUI_CONTAINER bash -c "cd /ComfyUI/custom_nodes && git clone https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite.git"
        echo "✅ Đã cài đặt ComfyUI-VideoHelperSuite"
    else
        echo "✅ ComfyUI-VideoHelperSuite đã được cài đặt. Cập nhật repository..."
        sudo docker exec $COMFYUI_CONTAINER bash -c "cd /ComfyUI/custom_nodes/ComfyUI-VideoHelperSuite && git pull"
    fi
    
    # Cài đặt các gói Python cần thiết cho các node
    echo "🔄 Đang cài đặt các gói Python cần thiết..."
    sudo docker exec $COMFYUI_CONTAINER bash -c "pip install -r /ComfyUI/custom_nodes/ComfyUI-VideoHelperSuite/requirements.txt"
    sudo docker exec $COMFYUI_CONTAINER bash -c "pip install -r /ComfyUI/custom_nodes/ComfyUI-GGUF/requirements.txt"
    echo "✅ Đã cài đặt các gói Python cần thiết"
else
    echo "❌ Không tìm thấy container ComfyUI đang chạy. Vui lòng đảm bảo container đã được khởi động."
fi

echo "--------- 🟢 Bắt đầu tải thêm các model Wan2.1 mới -----------"

# Tải thêm các model Wan2.1 mới
echo "Đang tải các model Wan2.1 mới..."

# Tải mô hình clip_vision
download_model "https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/clip_vision/clip_vision_h.safetensors" \
  "~/n8n/storage/ComfyUI/models/clip_vision/clip_vision_h.safetensors"

# Mặc định tự động tải cả mô hình 14B
echo "Tự động tải tất cả các mô hình bao gồm cả mô hình 14B..."
download_14b="y"
if [[ "$download_14b" == "y" ]]; then
    # Tải mô hình t2v (text to video) 14B
    download_model "https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/diffusion_models/wan2.1_t2v_14B_fp8_e4m3fn.safetensors" \
      "~/n8n/storage/ComfyUI/models/diffusion_models/wan2.1_t2v_14B_fp8_e4m3fn.safetensors"
    
    # Tải mô hình i2v (image to video) 14B
    download_model "https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/diffusion_models/wan2.1_i2v_720p_14B_fp8_e4m3fn.safetensors" \
      "~/n8n/storage/ComfyUI/models/diffusion_models/wan2.1_i2v_720p_14B_fp8_e4m3fn.safetensors"
else
    echo "Bỏ qua tải mô hình 14B."
fi

# Cấp quyền cho thư mục models
chmod -R 777 ~/n8n/storage/ComfyUI/models
chmod -R 777 ~/n8n/storage/ComfyUI/custom_nodes

# Khởi động lại container ComfyUI để áp dụng thay đổi
if [ -n "$COMFYUI_CONTAINER" ]; then
    echo "🔄 Đang khởi động lại container ComfyUI..."
    sudo docker restart $COMFYUI_CONTAINER
    echo "✅ Đã khởi động lại container ComfyUI"
fi

echo "--------- 🟢 Kiểm tra cài đặt -----------"
echo "Kiểm tra cài đặt ComfyUI và các node mới..."

# Kiểm tra ComfyUI
if [ -n "$COMFYUI_CONTAINER" ]; then
    echo "- ComfyUI container: ✅ (ID: $COMFYUI_CONTAINER)"
else
    echo "- ComfyUI container: ❌ (Không tìm thấy)"
fi

# Kiểm tra các node
for node in "ComfyUI-GGUF" "ComfyUI-VideoHelperSuite"; do
    if [ -d "~/n8n/storage/ComfyUI/custom_nodes/$node" ]; then
        echo "- Node $node: ✅"
    else
        echo "- Node $node: ❌ (Không tìm thấy)"
    fi
done

# Kiểm tra các model
for model_type in "text_encoders" "diffusion_models" "clip_vision" "vae"; do
    echo "Các model trong ~/n8n/storage/ComfyUI/models/$model_type:"
    ls -la ~/n8n/storage/ComfyUI/models/$model_type 2>/dev/null || echo "  Không tìm thấy thư mục này"
done

echo "--------- 🔴 Hoàn thành cập nhật ComfyUI và cài đặt node mới -----------"

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
echo "4. Để cài đặt thủ công CUDA 12.6.3, tham khảo: https://developer.nvidia.com/cuda-12-6-3-download-archive"

