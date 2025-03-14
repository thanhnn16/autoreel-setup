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

Ứng dụng cung cấp các API endpoints sau đây. **Lưu ý: Tất cả các endpoints đều phải có tiền tố `/api`**.

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
- **Ví dụ gọi API**:
  ```bash
  curl -X POST http://localhost:3000/api/process/task \
    -H "Content-Type: application/json" \
    -d '{"id":"task_001","images":["https://example.com/image1.jpg"],"durations":[5],"voiceUrl":"https://example.com/audio.mp3"}'
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
- **Ví dụ gọi API**:
  ```bash
  curl http://localhost:3000/api/process/task/task_001/status
  ```

#### Tải video đã xử lý
- **Endpoint**: `GET /api/process/task/:id/download`
- **Mô tả**: Tải xuống video đã được xử lý
- **Ví dụ gọi API**:
  ```bash
  # Tải xuống bằng curl
  curl -o video.mp4 http://localhost:3000/api/process/task/task_001/download
  
  # Hoặc mở trực tiếp trong trình duyệt
  http://localhost:3000/api/process/task/task_001/download
  ```

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
- **Ví dụ gọi API**:
  ```bash
  curl http://localhost:3000/api/process/processing
  ```

#### Tải video từ thư mục output
- **Endpoint**: `GET /api/process/output/:filename`
- **Mô tả**: Tải xuống video từ thư mục output qua tên file
- **Ví dụ gọi API**:
  ```bash
  # Tải xuống bằng curl
  curl -o video.mp4 http://localhost:3000/api/process/output/output_task_001.mp4
  
  # Hoặc mở trực tiếp trong trình duyệt
  http://localhost:3000/api/process/output/output_task_001.mp4
  ```

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
- **Ví dụ gọi API**:
  ```bash
  curl -X POST http://localhost:3000/api/process/ffmpeg \
    -H "Content-Type: application/json" \
    -d '{"args":["-i","input.mp4","-c:v","libx264","-preset","medium","output.mp4"]}'
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
- **Ví dụ gọi API**:
  ```bash
  curl -X POST http://localhost:3000/api/process/ffprobe \
    -H "Content-Type: application/json" \
    -d '{"args":["-i","video.mp4","-show_format","-show_streams","-print_format","json"]}'
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
- **Ví dụ gọi API**:
  ```bash
  curl http://localhost:3000/api/logs
  ```

#### Lấy nội dung log
- **Endpoint**: `GET /api/logs/:filename`
- **Mô tả**: Lấy nội dung của một file log cụ thể
- **Ví dụ gọi API**:
  ```bash
  curl http://localhost:3000/api/logs/app.log
  ```

## Ví dụ sử dụng API với JavaScript/Axios

```javascript
// Tạo task mới
async function createTask() {
  const response = await axios.post('http://localhost:3000/api/process/task', {
    id: 'task_001',
    images: ['https://example.com/image1.jpg', 'https://example.com/image2.jpg'],
    durations: [5, 5],
    voiceUrl: 'https://example.com/audio.mp3'
  });
  console.log(response.data);
}

// Kiểm tra trạng thái task
async function checkTaskStatus(taskId) {
  const response = await axios.get(`http://localhost:3000/api/process/task/${taskId}/status`);
  console.log(response.data);
  return response.data;
}

// Tải video
async function downloadVideo(taskId) {
  const response = await axios.get(`http://localhost:3000/api/process/task/${taskId}/download`, {
    responseType: 'blob'
  });
  // Xử lý blob video
  return response.data;
}
```

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