#!/bin/bash

# Script di chuyển file từ host vào container ComfyUI
echo "Bắt đầu di chuyển file từ host vào container ComfyUI..."

# Danh sách các thư mục cần kiểm tra
DIRECTORIES=(
  "checkpoints"
  "clip_vision"
  "diffusion_models"
  "text_encoders"
  "vae"
  "vae_approx"
)

# Đường dẫn gốc trên host
HOST_PATH="storage/ComfyUI/models"

for dir in "${DIRECTORIES[@]}"; do
  echo "Kiểm tra thư mục: $dir"
  
  # Kiểm tra xem thư mục có tồn tại trên host không
  if [ -d "$HOST_PATH/$dir" ]; then
    # Đảm bảo thư mục đích tồn tại trong container
    docker exec comfyui mkdir -p "/root/ComfyUI/models/$dir"
    
    # Tìm tất cả các file trong thư mục host và di chuyển vào container
    find "$HOST_PATH/$dir" -type f -print | while read file; do
      filename=$(basename "$file")
      echo "Di chuyển file: $filename vào thư mục $dir"
      
      # Sử dụng docker cp để sao chép file vào container
      docker cp "$file" "comfyui:/root/ComfyUI/models/$dir/$filename"
      
      # Đặt quyền cho file trong container
      docker exec comfyui chmod 644 "/root/ComfyUI/models/$dir/$filename"
    done
  else
    echo "Thư mục $dir không tồn tại trên host, bỏ qua."
  fi
done

echo "Hoàn tất di chuyển file!"