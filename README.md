# Fork from [MIAI_n8n_dockercompose](https://github.com/thangnch/MIAI_n8n_dockercompose)

## Yêu cầu hệ thống
- NVIDIA GPU (đã được tối ưu cho RTX 3090)
- NVIDIA Driver version 535.154.05 trở lên (hỗ trợ CUDA 12.2)
- Docker và Docker Compose
- Ubuntu 20.04 hoặc mới hơn

## Cài đặt tự động
``` sh
curl -s -o install.sh https://raw.githubusercontent.com/thanhnn16/autoreel-setup/main/install.sh
chmod +x install.sh
sudo ./install.sh
```

## Cài đặt thủ công

### 1. Clone repository
```sh
git clone https://github.com/thanhnn16/autoreel-setup.git
cd autoreel-setup
```

### 2. Kiểm tra phiên bản CUDA
```sh
nvidia-smi
```
Đảm bảo phiên bản CUDA là 12.2 và driver tương thích.

### 3. Build và khởi động dịch vụ
```sh
docker compose build
docker compose up -d
```

## Quản lý dịch vụ

### Khởi động tất cả dịch vụ
``` sh
docker compose --profile gpu-nvidia --profile localai --profile n8n up -d
```

### Dừng tất cả dịch vụ
``` sh
docker compose --profile gpu-nvidia --profile localai --profile n8n down
```

## Các dịch vụ đã cài đặt
- **n8n**: Truy cập tại https://n8n.autoreel.io.vn
- **ComfyUI**: Truy cập tại http://n8n.autoreel.io.vn:8188
- **LocalAI**: Truy cập tại http://n8n.autoreel.io.vn:8080
- **Qdrant**: Truy cập tại http://n8n.autoreel.io.vn:6333

## Thông tin về Tối ưu hóa CUDA 12.2
Hệ thống này đã được tối ưu hóa đặc biệt cho NVIDIA GeForce RTX 3090 chạy CUDA 12.2. Các thành phần chính đã được điều chỉnh:

1. **Dockerfile**: Sử dụng image base `nvidia/cuda:12.2.0-base-ubuntu20.04`
2. **docker-compose.yml**: Đã cấu hình các container để sử dụng GPU với CUDA 12.2
3. **install.sh**: Bao gồm các bước cài đặt và kiểm tra CUDA 12.2, NVIDIA driver 535

## Xử lý sự cố
Nếu gặp vấn đề với CUDA hoặc GPU, hãy thử:
```sh
# Kiểm tra tình trạng GPU
nvidia-smi

# Kiểm tra Docker có thể truy cập GPU không
docker run --rm --gpus all nvidia/cuda:12.2.0-base-ubuntu20.04 nvidia-smi

# Kiểm tra trạng thái container
docker ps -a
```

