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