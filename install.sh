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
      
      # Nếu phiên bản CUDA từ nvidia-smi đã là 12.2, không cần tiếp tục
      if [[ "$cuda_version" == "12.2" ]]; then
        echo "✅ CUDA Runtime phiên bản 12.2 đã được cài đặt. Không cần cài đặt lại."
        return 0
      fi
    fi
  fi
  
  # Kiểm tra nvcc (CUDA compiler)
  if command -v nvcc &> /dev/null; then
    nvcc_version=$(nvcc --version | grep "release" | awk '{print $6}' | cut -d',' -f1)
    echo "✅ CUDA Toolkit đã được cài đặt, phiên bản: $nvcc_version (từ nvcc)"
    
    # Nếu phiên bản CUDA từ nvcc cũng khác 12.2 thì mới thực hiện nâng cấp/downgrade
    if [[ "$nvcc_version" != "12.2" ]]; then
      echo "⚠️ Phiên bản CUDA Toolkit hiện tại khác 12.2. Đang cài đặt CUDA 12.2.0..."
      install_cuda_12_2_0
    else
      echo "✅ CUDA Toolkit phiên bản 12.2 đã được cài đặt. Không cần cài đặt lại."
    fi
  else
    # Nếu đã có CUDA Runtime 12.2 từ nvidia-smi nhưng không có nvcc
    if [[ "$cuda_version" == "12.2" ]]; then
      echo "⚠️ CUDA Runtime 12.2 đã cài đặt nhưng không tìm thấy CUDA Toolkit (nvcc)."
      # Tự động cài đặt CUDA Toolkit mà không hỏi người dùng
      echo "Tự động cài đặt đầy đủ CUDA Toolkit..."
      install_cuda_12_2_0
    else
      echo "⚠️ CUDA chưa được cài đặt đầy đủ. Đang cài đặt CUDA 12.2.0..."
      install_cuda_12_2_0
    fi
  fi
}

# Hàm riêng để cài đặt CUDA 12.2.0
install_cuda_12_2_0() {
  # Chuẩn bị hệ thống
  wait_for_apt && sudo DEBIAN_FRONTEND=noninteractive apt-get update -y
  wait_for_apt && sudo DEBIAN_FRONTEND=noninteractive apt-get install -y build-essential linux-headers-$(uname -r)
  
  # Xóa cài đặt CUDA cũ nếu có
  echo "Xóa cài đặt CUDA cũ nếu có..."
  wait_for_apt && sudo DEBIAN_FRONTEND=noninteractive apt-get purge -y cuda* --autoremove
  sudo rm -rf /usr/local/cuda*
  
  # Tải và cài đặt CUDA 12.2.0 theo yêu cầu của người dùng
  echo "Tải CUDA 12.2.0 installer..."
  wget https://developer.download.nvidia.com/compute/cuda/12.2.0/local_installers/cuda_12.2.0_535.54.03_linux.run
  
  # Cấp quyền thực thi
  chmod +x cuda_12.2.0_535.54.03_linux.run
  
  # Cài đặt CUDA 12.2.0 ở chế độ không tương tác (silent)
  echo "Cài đặt CUDA 12.2.0 ở chế độ không tương tác..."
  sudo ./cuda_12.2.0_535.54.03_linux.run --silent --toolkit --samples --no-opengl-libs --override
  
  # Thiết lập biến môi trường
  echo 'export PATH=/usr/local/cuda-12.2/bin${PATH:+:${PATH}}' >> ~/.bashrc
  echo 'export LD_LIBRARY_PATH=/usr/local/cuda-12.2/lib64${LD_LIBRARY_PATH:+:${LD_LIBRARY_PATH}}' >> ~/.bashrc
  source ~/.bashrc
  
  # Cập nhật PATH cho toàn hệ thống
  echo "/usr/local/cuda-12.2/lib64" | sudo tee /etc/ld.so.conf.d/cuda.conf
  sudo ldconfig
  
  # Kiểm tra lại cài đặt
  if command -v nvcc &> /dev/null; then
    nvcc_version=$(nvcc --version | grep "release" | awk '{print $6}' | cut -d',' -f1)
    echo "✅ CUDA đã được cài đặt thành công, phiên bản: $nvcc_version"
    
    # Kiểm tra chi tiết hơn với deviceQuery
    echo "Cài đặt các gói phụ thuộc cho CUDA samples..."
    wait_for_apt && sudo DEBIAN_FRONTEND=noninteractive apt-get install -y freeglut3-dev libx11-dev libxi-dev libxmu-dev libglu1-mesa-dev
    
    if [ -d "/usr/local/cuda-12.2/samples/1_Utilities/deviceQuery" ]; then
      echo "Xác minh cài đặt CUDA với deviceQuery..."
      cd /usr/local/cuda-12.2/samples/1_Utilities/deviceQuery
      sudo make > /dev/null 2>&1
      ./deviceQuery
    fi
  else
    echo "⚠️ Cài đặt CUDA không thành công. Vui lòng cài đặt thủ công."
  fi
}

# Hàm kiểm tra GPU cho Docker
verify_gpu_for_docker() {
  echo "Kiểm tra GPU cho Docker..."
  
  # Kiểm tra xem Docker có thể truy cập GPU không
  if sudo docker run --rm --gpus all nvidia/cuda:12.2.0-base-ubuntu22.04 nvidia-smi &> /dev/null; then
    echo "✅ Docker có thể truy cập GPU thành công."
    # Hiển thị thông tin GPU từ container
    sudo docker run --rm --gpus all nvidia/cuda:12.2.0-base-ubuntu22.04 nvidia-smi
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
    if sudo docker run --rm --gpus all nvidia/cuda:12.2.0-base-ubuntu22.04 nvidia-smi &> /dev/null; then
      echo "✅ Docker đã có thể truy cập GPU thành công."
      sudo docker run --rm --gpus all nvidia/cuda:12.2.0-base-ubuntu22.04 nvidia-smi
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

# Kiểm tra xem thư mục n8n đã tồn tại chưa
if [ -d "n8n" ]; then
    echo "⚠️ Thư mục n8n đã tồn tại. Đang tạo bản sao lưu..."
    timestamp=$(date +%Y%m%d%H%M%S)
    mv n8n n8n_backup_$timestamp
    echo "✅ Đã tạo bản sao lưu thư mục n8n cũ thành n8n_backup_$timestamp"
fi

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
sudo snap install --classic certbot
sudo ln -sf /snap/bin/certbot /usr/bin/certbot
echo "--------- 🔴 Hoàn thành cài đặt Certbot -----------"

echo "--------- 🟢 Bắt đầu thiết lập SSL với Certbot -----------"
# Kiểm tra xem thư mục nginx/letsencrypt có tồn tại không
if [ -d "./nginx/letsencrypt" ]; then
    echo "Tìm thấy thư mục chứng chỉ SSL đã lưu trong nginx/letsencrypt"
    echo "Sao chép chứng chỉ SSL đã lưu vào thư mục /etc/letsencrypt"
    
    # Tạo thư mục /etc/letsencrypt nếu chưa tồn tại
    sudo mkdir -p /etc/letsencrypt
    
    # Sao chép toàn bộ nội dung từ thư mục nginx/letsencrypt vào /etc/letsencrypt
    sudo cp -r ./nginx/letsencrypt/* /etc/letsencrypt/
    
    # Đặt quyền truy cập đúng cho thư mục letsencrypt
    sudo chmod -R 755 /etc/letsencrypt
    sudo chmod -R 700 /etc/letsencrypt/archive
    sudo chmod -R 700 /etc/letsencrypt/live
    
    echo "Đã sao chép chứng chỉ SSL thành công"
else
    echo "Không tìm thấy thư mục chứng chỉ SSL đã lưu trong nginx/letsencrypt"
    echo "Đang tạo chứng chỉ SSL mới với Certbot..."
    
    # Chạy certbot để lấy chứng chỉ SSL, chế độ tự động và không tương tác
    sudo certbot --nginx --non-interactive --agree-tos --redirect \
        --staple-ocsp --email thanhnn16.work@gmail.com -d n8n.autoreel.io.vn
fi
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

# echo "--------- 🟢 Khởi động n8n với Docker Compose -----------"
# echo "Đang khởi động các container..."
# sudo docker-compose up -d
# echo "Các container đã được khởi động thành công!"
# echo "--------- 🔴 n8n đã được khởi động -----------"

# echo "--------- 🟢 Bắt đầu tải Flux1 Checkpoint -----------"
# echo "Tạo thư mục cho Flux1 Checkpoint trong container..."
# COMFYUI_CONTAINER=$(sudo docker ps | grep comfyui | awk '{print $1}')

# if [ -n "$COMFYUI_CONTAINER" ]; then
#     echo "✅ Tìm thấy container ComfyUI: $COMFYUI_CONTAINER"
    
#     # Tạo thư mục trong container
#     sudo docker exec $COMFYUI_CONTAINER mkdir -p /root/ComfyUI/models/checkpoints/FLUX1
    
#     # Đường dẫn đến file Flux1 Checkpoint trong container
#     FLUX1_FILE="/root/ComfyUI/models/checkpoints/FLUX1/flux1-dev-fp8.safetensors"
    
#     # Kiểm tra xem file đã tồn tại trong container chưa
#     if sudo docker exec $COMFYUI_CONTAINER test -f "$FLUX1_FILE"; then
#         echo "File Flux1-dev-fp8 Checkpoint đã tồn tại trong container. Bỏ qua bước tải..."
#     else
#         echo "Đang tải Flux1-dev-fp8 Checkpoint trực tiếp vào container..."
#         sudo docker exec $COMFYUI_CONTAINER curl -L -o "$FLUX1_FILE" https://huggingface.co/Comfy-Org/flux1-dev/resolve/main/flux1-dev-fp8.safetensors
        
#         # Kiểm tra xem tải thành công không
#         if sudo docker exec $COMFYUI_CONTAINER test -f "$FLUX1_FILE"; then
#             echo "Tải Flux1-dev-fp8 Checkpoint thành công!"
#         else
#             echo "⚠️ Tải Flux1-dev-fp8 Checkpoint không thành công. Vui lòng tải thủ công sau."
#         fi
#     fi
    
#     # Đặt quyền cho thư mục và file trong container
#     sudo docker exec $COMFYUI_CONTAINER chmod -R 777 /root/ComfyUI/models
# else
#     echo "❌ Không tìm thấy container ComfyUI đang chạy. Vui lòng đảm bảo container đã được khởi động."
# fi
# echo "--------- 🔴 Hoàn thành tải Flux1 Checkpoint -----------"

# echo "--------- 🟢 Bắt đầu tải Wan2.1 và Flux Models -----------"

# if [ -n "$COMFYUI_CONTAINER" ]; then
#     # Tạo cấu trúc thư mục trong container
#     sudo docker exec $COMFYUI_CONTAINER mkdir -p /root/ComfyUI/models/{text_encoders,vae,diffusion_models,clip_vision,vae_approx}
#     # Tạo thư mục cho custom_nodes
#     sudo docker exec $COMFYUI_CONTAINER mkdir -p /root/ComfyUI/custom_nodes
    
#     # Hàm kiểm tra và tải model trực tiếp vào container
#     download_model_to_container() {
#       local url=$1
#       local dest=$2
#       local filename=$(basename "$dest")
      
#       if sudo docker exec $COMFYUI_CONTAINER test -f "$dest"; then
#         echo "✅ $filename đã tồn tại trong container. Bỏ qua..."
#       else
#         echo "🔄 Đang tải $filename trực tiếp vào container..."
#         sudo docker exec $COMFYUI_CONTAINER curl -L -o "$dest" "$url"
        
#         if sudo docker exec $COMFYUI_CONTAINER test -f "$dest"; then
#           echo "✅ Tải $filename thành công!"
#         else
#           echo "❌ Lỗi khi tải $filename"
#         fi
#       fi
#     }
    
#     # Tải các model Wan2.1 trực tiếp vào container
#     echo "Đang tải các model Wan2.1 trực tiếp vào container..."
#     download_model_to_container "https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors" \
#       "/root/ComfyUI/models/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors"
    
#     download_model_to_container "https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/vae/wan_2.1_vae.safetensors" \
#       "/root/ComfyUI/models/vae/wan_2.1_vae.safetensors"
    
#     download_model_to_container "https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/diffusion_models/wan2.1_t2v_1.3B_bf16.safetensors" \
#       "/root/ComfyUI/models/diffusion_models/wan2.1_t2v_1.3B_bf16.safetensors"
    
#     # Tải mô hình clip_vision trực tiếp vào container
#     download_model_to_container "https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/clip_vision/clip_vision_h.safetensors" \
#       "/root/ComfyUI/models/clip_vision/clip_vision_h.safetensors"
    
#     # Tải các mô hình vae_approx trực tiếp vào container
#     download_model_to_container "https://github.com/comfyanonymous/ComfyUI/raw/master/models/vae_approx/taesd_decoder.pth" \
#       "/root/ComfyUI/models/vae_approx/taesd_decoder.pth"
    
#     download_model_to_container "https://github.com/comfyanonymous/ComfyUI/raw/master/models/vae_approx/taesdxl_decoder.pth" \
#       "/root/ComfyUI/models/vae_approx/taesdxl_decoder.pth"
    
#     download_model_to_container "https://github.com/comfyanonymous/ComfyUI/raw/master/models/vae_approx/taesd3_decoder.pth" \
#       "/root/ComfyUI/models/vae_approx/taesd3_decoder.pth"
    
#     download_model_to_container "https://github.com/comfyanonymous/ComfyUI/raw/master/models/vae_approx/taef1_decoder.pth" \
#       "/root/ComfyUI/models/vae_approx/taef1_decoder.pth"
    
#     # Mặc định tự động tải cả mô hình 14B
#     echo "Tự động tải tất cả các mô hình bao gồm cả mô hình 14B..."
#     download_14b="y"
#     if [[ "$download_14b" == "y" ]]; then
#         # Tải mô hình t2v (text to video) 14B trực tiếp vào container
#         download_model_to_container "https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/diffusion_models/wan2.1_t2v_14B_fp8_e4m3fn.safetensors" \
#           "/root/ComfyUI/models/diffusion_models/wan2.1_t2v_14B_fp8_e4m3fn.safetensors"
        
#         # Tải mô hình i2v (image to video) 14B trực tiếp vào container
#         download_model_to_container "https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/diffusion_models/wan2.1_i2v_720p_14B_fp8_e4m3fn.safetensors" \
#           "/root/ComfyUI/models/diffusion_models/wan2.1_i2v_720p_14B_fp8_e4m3fn.safetensors"
#     else
#         echo "Bỏ qua tải mô hình 14B."
#     fi
    
#     # Đặt quyền cho thư mục và file trong container
#     sudo docker exec $COMFYUI_CONTAINER chmod -R 777 /root/ComfyUI/models
#     sudo docker exec $COMFYUI_CONTAINER chmod -R 777 /root/ComfyUI/custom_nodes
# else
#     echo "❌ Không tìm thấy container ComfyUI đang chạy. Vui lòng đảm bảo container đã được khởi động."
# fi

# echo "--------- 🔴 Hoàn thành tải model -----------"

# echo "--------- 🟢 Bắt đầu cập nhật ComfyUI và cài đặt node mới -----------"
# # Vào thư mục ComfyUI trong container để cập nhật
# echo "Bắt đầu cập nhật ComfyUI..."

# if [ -n "$COMFYUI_CONTAINER" ]; then
#     echo "✅ Tìm thấy container ComfyUI: $COMFYUI_CONTAINER"
#     # Cập nhật ComfyUI từ GitHub
#     sudo docker exec $COMFYUI_CONTAINER bash -c "cd /ComfyUI && git pull"
#     echo "✅ Đã cập nhật ComfyUI lên phiên bản mới nhất"
    
#     # Cài đặt node ComfyUI-GGUF trực tiếp vào container
#     if ! sudo docker exec $COMFYUI_CONTAINER test -d "/root/ComfyUI/custom_nodes/ComfyUI-GGUF"; then
#         echo "🔄 Đang cài đặt ComfyUI-GGUF trực tiếp vào container..."
#         sudo docker exec $COMFYUI_CONTAINER bash -c "cd /root/ComfyUI/custom_nodes && git clone https://github.com/city96/ComfyUI-GGUF.git"
#         echo "✅ Đã cài đặt ComfyUI-GGUF"
#     else
#         echo "✅ ComfyUI-GGUF đã được cài đặt. Cập nhật repository..."
#         sudo docker exec $COMFYUI_CONTAINER bash -c "cd /root/ComfyUI/custom_nodes/ComfyUI-GGUF && git pull"
#     fi
    
#     # Cài đặt node ComfyUI-VideoHelperSuite trực tiếp vào container
#     if ! sudo docker exec $COMFYUI_CONTAINER test -d "/root/ComfyUI/custom_nodes/ComfyUI-VideoHelperSuite"; then
#         echo "🔄 Đang cài đặt ComfyUI-VideoHelperSuite trực tiếp vào container..."
#         sudo docker exec $COMFYUI_CONTAINER bash -c "cd /root/ComfyUI/custom_nodes && git clone https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite.git"
#         echo "✅ Đã cài đặt ComfyUI-VideoHelperSuite"
#     else
#         echo "✅ ComfyUI-VideoHelperSuite đã được cài đặt. Cập nhật repository..."
#         sudo docker exec $COMFYUI_CONTAINER bash -c "cd /root/ComfyUI/custom_nodes/ComfyUI-VideoHelperSuite && git pull"
#     fi
    
#     # Cài đặt các gói Python cần thiết cho các node trong container
#     echo "🔄 Đang cài đặt các gói Python cần thiết..."
#     sudo docker exec $COMFYUI_CONTAINER bash -c "pip install -r /root/ComfyUI/custom_nodes/ComfyUI-VideoHelperSuite/requirements.txt"
#     sudo docker exec $COMFYUI_CONTAINER bash -c "pip install -r /root/ComfyUI/custom_nodes/ComfyUI-GGUF/requirements.txt"
#     echo "✅ Đã cài đặt các gói Python cần thiết"
    
#     # Khởi động lại container ComfyUI để áp dụng thay đổi
#     echo "🔄 Đang khởi động lại container ComfyUI..."
#     sudo docker restart $COMFYUI_CONTAINER
#     echo "✅ Đã khởi động lại container ComfyUI"
# else
#     echo "❌ Không tìm thấy container ComfyUI đang chạy. Vui lòng đảm bảo container đã được khởi động."
# fi

# echo "--------- 🔴 Hoàn thành cập nhật ComfyUI và cài đặt node mới -----------"

# echo "--------- 🟢 Kiểm tra cài đặt -----------"
# echo "Kiểm tra cài đặt ComfyUI và các node mới..."

# # Kiểm tra ComfyUI
# if [ -n "$COMFYUI_CONTAINER" ]; then
#     echo "- ComfyUI container: ✅ (ID: $COMFYUI_CONTAINER)"
    
#     # Kiểm tra các node trong container
#     for node in "ComfyUI-GGUF" "ComfyUI-VideoHelperSuite"; do
#         if sudo docker exec $COMFYUI_CONTAINER test -d "/root/ComfyUI/custom_nodes/$node"; then
#             echo "- Node $node: ✅"
#         else
#             echo "- Node $node: ❌ (Không tìm thấy)"
#         fi
#     done
    
#     # Kiểm tra các model trong container
#     for model_type in "text_encoders" "diffusion_models" "clip_vision" "vae" "vae_approx"; do
#         echo "Các model trong /root/ComfyUI/models/$model_type:"
#         sudo docker exec $COMFYUI_CONTAINER ls -la "/root/ComfyUI/models/$model_type" 2>/dev/null || echo "  Không tìm thấy thư mục này"
#     done
# else
#     echo "- ComfyUI container: ❌ (Không tìm thấy)"
# fi

echo "--------- 🔴 Hoàn thành kiểm tra cài đặt -----------"

echo "--------- 🟢 Dọn dẹp các file tạm và thư mục dư thừa -----------"
cleanup_temp_files
echo "--------- 🔴 Hoàn thành dọn dẹp -----------"

echo "Cài đặt hoàn tất! Truy cập n8n tại https://n8n.autoreel.io.vn"
echo ""
echo "Thông tin hệ thống:"
echo "- Docker version: $(docker --version)"
echo "- Docker Compose version: $(docker-compose --version)"
if command -v nvcc &> /dev/null; then
  echo "- CUDA version: $(nvcc --version | grep "release" | awk '{print $6}' | cut -d',' -f1)"
fi

