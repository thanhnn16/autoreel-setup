#!/bin/bash
# Script tải các checkpoint và model cho ComfyUI

# Đặt biến môi trường
MODEL_DIR="$HOME/n8n/storage/ComfyUI/models"
CUSTOM_NODES_DIR="$HOME/n8n/storage/ComfyUI/custom_nodes"

# Hàm hiển thị tin nhắn đẹp hơn
print_section() {
  echo "--------- 🟢 $1 -----------"
}

print_end_section() {
  echo "--------- 🔴 $1 -----------"
}

# Hàm kiểm tra xem package python đã được cài đặt chưa
check_package() {
  if pip list | grep -q "$1"; then
    echo "✅ Gói $1 đã được cài đặt"
    return 0
  else
    echo "❌ Gói $1 chưa được cài đặt"
    return 1
  fi
}

# Hàm kiểm tra xem thư mục tồn tại và trống không
check_directory() {
  if [ ! -d "$1" ]; then
    echo "Thư mục $1 không tồn tại, đang tạo..."
    mkdir -p "$1"
    return 0
  elif [ -z "$(ls -A "$1")" ]; then
    echo "Thư mục $1 trống"
    return 0
  else
    echo "Thư mục $1 đã tồn tại và có nội dung"
    return 1
  fi
}

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

# Hàm tạo thư mục nếu chưa tồn tại
create_directory() {
  if [ ! -d "$1" ]; then
    mkdir -p "$1"
    echo "Đã tạo thư mục $1"
  fi
}

# Hàm cài đặt custom node
install_custom_node() {
  local node_name=$1
  local git_url=$2
  local requirements_file=$3
  
  echo "Kiểm tra custom node $node_name..."
  
  # Kiểm tra xem thư mục custom node đã tồn tại chưa
  if [ -d "$CUSTOM_NODES_DIR/$node_name" ]; then
    echo "Thư mục $node_name đã tồn tại. Cập nhật repository..."
    cd "$CUSTOM_NODES_DIR/$node_name"
    git pull
  else
    echo "Thư mục $node_name chưa tồn tại. Clone repository..."
    cd "$CUSTOM_NODES_DIR"
    git clone "$git_url" "$node_name"
  fi
  
  # Cài đặt các gói phụ thuộc nếu có file requirements
  if [ -f "$CUSTOM_NODES_DIR/$node_name/$requirements_file" ]; then
    echo "Cài đặt các gói phụ thuộc cho $node_name..."
    pip install -r "$CUSTOM_NODES_DIR/$node_name/$requirements_file"
  fi
  
  echo "✅ Hoàn thành cài đặt $node_name"
}

# Kiểm tra và tạo thư mục gốc cho models
create_directory "$MODEL_DIR"

# Kiểm tra và tạo thư mục cho custom nodes
create_directory "$CUSTOM_NODES_DIR"

# 1. Tải và cài đặt custom nodes
print_section "Bắt đầu tải và cài đặt custom nodes"

# Cài đặt ComfyUI-GGUF
install_custom_node "ComfyUI-GGUF" "https://github.com/city96/ComfyUI-GGUF.git" "requirements.txt"

# Cài đặt ComfyUI-VideoHelperSuite
install_custom_node "ComfyUI-VideoHelperSuite" "https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite.git" "requirements.txt"

print_end_section "Hoàn thành tải và cài đặt custom nodes"

# 2. Tải Flux1 Checkpoint
print_section "Bắt đầu tải Flux1 Checkpoint"

# Tạo thư mục cho Flux1 Checkpoint
create_directory "$MODEL_DIR/checkpoints/FLUX1"

# Đường dẫn đến file Flux1 Checkpoint
FLUX1_FILE="$MODEL_DIR/checkpoints/FLUX1/flux1-dev-fp8.safetensors"

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

print_end_section "Hoàn thành tải Flux1 Checkpoint"

# 3. Kiểm tra thư mục GGUF và tải model GGUF nếu cần
print_section "Kiểm tra và tải model GGUF"

# Tạo thư mục cho model GGUF
create_directory "$MODEL_DIR/gguf"

# Đường dẫn đến model GGUF
GGUF_MODEL="$MODEL_DIR/gguf/flux1-dev-q4_0.gguf"

# Hỏi người dùng có muốn tải model GGUF không
echo -n "Bạn có muốn tải model GGUF cho Flux1 (tiết kiệm VRAM) không? [y/N]: "
read -r download_gguf

if [[ "$download_gguf" == "y" || "$download_gguf" == "Y" ]]; then
    if [ -f "$GGUF_MODEL" ]; then
        echo "Model GGUF đã tồn tại. Bỏ qua bước tải..."
    else
        echo "Đang tải model GGUF cho Flux1..."
        # URL là ví dụ, cần thay thế bằng URL thực tế nếu có
        wget -q --show-progress -O "$GGUF_MODEL" "https://huggingface.co/city96/ComfyUI-GGUF/resolve/main/flux1-dev-q4_0.gguf"
        
        if [ -f "$GGUF_MODEL" ]; then
            echo "✅ Tải model GGUF thành công!"
        else
            echo "❌ Lỗi khi tải model GGUF"
        fi
    fi
else
    echo "Bỏ qua tải model GGUF."
fi

print_end_section "Hoàn thành kiểm tra model GGUF"

# 4. Tải Wan2.1 và Flux Models
print_section "Bắt đầu tải Wan2.1 và Flux Models"

# Tạo cấu trúc thư mục cho Wan2.1
create_directory "$MODEL_DIR/text_encoders"
create_directory "$MODEL_DIR/vae"
create_directory "$MODEL_DIR/diffusion_models"
create_directory "$MODEL_DIR/clip_vision"

# Tải các model Wan2.1
echo "Đang tải các model Wan2.1..."
download_model "https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors" \
  "$MODEL_DIR/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors"

download_model "https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/vae/wan_2.1_vae.safetensors" \
  "$MODEL_DIR/vae/wan_2.1_vae.safetensors"

download_model "https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/diffusion_models/wan2.1_t2v_1.3B_bf16.safetensors" \
  "$MODEL_DIR/diffusion_models/wan2.1_t2v_1.3B_bf16.safetensors"

print_end_section "Hoàn thành tải model cơ bản"

# 5. Tải thêm các model Wan2.1 mới
print_section "Bắt đầu tải thêm các model Wan2.1 mới"

# Tải mô hình clip_vision
download_model "https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/clip_vision/clip_vision_h.safetensors" \
  "$MODEL_DIR/clip_vision/clip_vision_h.safetensors"

# Hỏi người dùng có muốn tải model 14B không
echo -n "Bạn có muốn tải mô hình 14B không? (model này có kích thước lớn ~20GB) [y/N]: "
read -r download_14b

if [[ "$download_14b" == "y" || "$download_14b" == "Y" ]]; then
    echo "Đang tải các mô hình 14B..."
    
    # Tải mô hình t2v (text to video) 14B
    download_model "https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/diffusion_models/wan2.1_t2v_14B_fp8_e4m3fn.safetensors" \
      "$MODEL_DIR/diffusion_models/wan2.1_t2v_14B_fp8_e4m3fn.safetensors"
    
    # Tải mô hình i2v (image to video) 14B
    download_model "https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/diffusion_models/wan2.1_i2v_720p_14B_fp8_e4m3fn.safetensors" \
      "$MODEL_DIR/diffusion_models/wan2.1_i2v_720p_14B_fp8_e4m3fn.safetensors"
else
    echo "Bỏ qua tải mô hình 14B."
fi

print_end_section "Hoàn thành tải model"

# Cấp quyền cho thư mục models và custom_nodes
echo "Đang cấp quyền cho thư mục models và custom_nodes..."
chmod -R 777 "$MODEL_DIR"
chmod -R 777 "$CUSTOM_NODES_DIR"

# Kiểm tra các model đã tải
print_section "Kiểm tra models và custom nodes đã tải"

echo "Danh sách checkpoint đã tải:"
ls -la "$MODEL_DIR/checkpoints" 2>/dev/null || echo "Không tìm thấy thư mục checkpoints"

echo "Danh sách model GGUF đã tải:"
ls -la "$MODEL_DIR/gguf" 2>/dev/null || echo "Không tìm thấy thư mục gguf"

for model_type in "text_encoders" "diffusion_models" "clip_vision" "vae"; do
    echo "Các model trong $MODEL_DIR/$model_type:"
    ls -la "$MODEL_DIR/$model_type" 2>/dev/null || echo "  Không tìm thấy thư mục này"
done

echo "Danh sách custom nodes đã cài đặt:"
ls -la "$CUSTOM_NODES_DIR" 2>/dev/null || echo "Không tìm thấy thư mục custom_nodes"

print_end_section "Hoàn thành kiểm tra"

echo "Tất cả các model và custom nodes đã được tải và cài đặt thành công!"
echo "Bạn có thể tìm thấy models trong thư mục: $MODEL_DIR"
echo "Và custom nodes trong thư mục: $CUSTOM_NODES_DIR"