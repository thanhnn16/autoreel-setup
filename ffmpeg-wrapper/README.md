# FFmpeg Wrapper

HTTP wrapper cho FFmpeg với quy trình xử lý mở rộng.

## Cài đặt

```bash
# Sử dụng npm
npm install

# Hoặc sử dụng Bun (khuyến nghị)
bun install
```

## Chạy ứng dụng

```bash
# Sử dụng npm
npm start

# Hoặc sử dụng Bun (khuyến nghị)
bun run start

# Chế độ phát triển với tự động khởi động lại
bun run dev
```

## API Endpoints

Ứng dụng cung cấp các API endpoints sau đây:

### Xử lý video

#### Tạo task mới
- **Endpoint**: `POST /api/process/task`
- **Mô tả**: Tạo một task xử lý video mới
- **Body**:
  ```json
  {
    "id": "task_001",
    "images": [
      "https://example.com/image1.jpg",
      "https://example.com/image2.jpg"
    ],
    "durations": [5, 5],
    "voiceUrl": "https://example.com/audio.mp3",
    "bgUrl": "https://example.com/background.mp3",
    "subtitleUrl": "https://example.com/subtitle.ass",
    "titleText": "Tiêu đề video"
  }
  ```
- **Phản hồi**:
  ```json
  {
    "status": "accepted",
    "message": "Task task_001 đã được chấp nhận và đang xử lý",
    "taskId": "task_001"
  }
  ```

#### Kiểm tra trạng thái task
- **Endpoint**: `GET /api/process/task/:id/status`
- **Mô tả**: Kiểm tra trạng thái của một task
- **Phản hồi**:
  ```json
  {
    "status": "processing",
    "taskId": "task_001"
  }
  ```
  hoặc
  ```json
  {
    "status": "completed",
    "taskId": "task_001",
    "outputPath": "output/output_task_001.mp4"
  }
  ```
  hoặc
  ```json
  {
    "status": "failed",
    "taskId": "task_001",
    "error": "Lỗi khi xử lý task"
  }
  ```

#### Tải video đã xử lý
- **Endpoint**: `GET /api/process/task/:id/download`
- **Mô tả**: Tải xuống video đã được xử lý

#### Kiểm tra danh sách task đang xử lý
- **Endpoint**: `GET /api/process/processing`
- **Mô tả**: Lấy danh sách các task đang được xử lý
- **Phản hồi**:
  ```json
  {
    "status": "success",
    "count": 2,
    "tasks": ["task_001", "task_002"]
  }
  ```

#### Tải video từ thư mục output
- **Endpoint**: `GET /api/process/output/:filename`
- **Mô tả**: Tải xuống video từ thư mục output qua tên file

### FFmpeg và FFprobe

#### Chạy lệnh FFmpeg
- **Endpoint**: `POST /api/process/ffmpeg`
- **Mô tả**: Chạy lệnh FFmpeg trực tiếp
- **Body**:
  ```json
  {
    "args": ["-i", "input.mp4", "-c:v", "libx264", "-preset", "medium", "output.mp4"]
  }
  ```
- **Phản hồi**:
  ```json
  {
    "code": 0,
    "stdout": "",
    "stderr": "..."
  }
  ```

#### Chạy lệnh FFprobe
- **Endpoint**: `POST /api/process/ffprobe`
- **Mô tả**: Chạy lệnh FFprobe trực tiếp
- **Body**:
  ```json
  {
    "args": ["-i", "video.mp4", "-show_format", "-show_streams", "-print_format", "json"]
  }
  ```
- **Phản hồi**:
  ```json
  {
    "code": 0,
    "stdout": "...",
    "stderr": "..."
  }
  ```

### Quản lý logs

#### Lấy danh sách logs
- **Endpoint**: `GET /api/logs`
- **Mô tả**: Lấy danh sách tất cả các file log
- **Phản hồi**:
  ```json
  {
    "logs": [
      {
        "name": "app.log",
        "path": "logs/app.log",
        "size": 1024,
        "created": "2023-11-15T12:00:00.000Z",
        "modified": "2023-11-15T12:30:00.000Z"
      }
    ]
  }
  ```

#### Lấy nội dung log
- **Endpoint**: `GET /api/logs/:filename`
- **Mô tả**: Lấy nội dung của một file log cụ thể

## Cấu trúc dự án

```
ffmpeg-wrapper/
├── src/
│   ├── config/       # Cấu hình ứng dụng
│   ├── routes/       # Định nghĩa API routes
│   ├── services/     # Các dịch vụ xử lý
│   ├── utils/        # Tiện ích
│   └── app.js        # Điểm khởi đầu ứng dụng
├── logs/             # Thư mục chứa log
├── temp/             # Thư mục chứa file tạm
├── output/           # Thư mục chứa file đầu ra
└── mock/             # Dữ liệu mẫu cho phát triển
```

## Sử dụng Alias Paths

Dự án này sử dụng một cách tiếp cận đơn giản để quản lý đường dẫn thông qua module `alias.js`.

### Cách sử dụng

```javascript
// Import module paths
import { paths } from '../utils/alias.js';

// Sử dụng đường dẫn
const configPath = join(paths.config, 'someFile.js');
```

Các đường dẫn có sẵn:
- `paths.root`: Thư mục gốc của dự án
- `paths.src`: Thư mục `src`
- `paths.config`: Thư mục `src/config`
- `paths.services`: Thư mục `src/services`
- `paths.utils`: Thư mục `src/utils`
- `paths.routes`: Thư mục `src/routes`

## Xử lý đường dẫn

Dự án sử dụng `path-browserify` để xử lý đường dẫn một cách nhất quán trên các hệ điều hành khác nhau.

```javascript
import path from 'path-browserify';

// Ví dụ
const filePath = path.join(directory, filename);
``` 