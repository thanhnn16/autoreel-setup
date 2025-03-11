/**
 * Khởi tạo ứng dụng Express
 */
// Import các đường dẫn

import express from 'express';
import config from './config/index.js';
import routes from './routes/index.js';
import logger from './utils/logger.js';
import { ensureDir } from './utils/fileManager.js';

// Khởi tạo ứng dụng Express
const app = express();

// Middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Middleware ghi log request
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.url}`, 'HTTP');
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info(`${req.method} ${req.url} ${res.statusCode} ${duration}ms`, 'HTTP');
  });
  
  next();
});

// Middleware xử lý lỗi CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  next();
});

// Đảm bảo các thư mục cần thiết tồn tại
async function ensureDirectories() {
  try {
    await ensureDir(config.paths.logs);
    await ensureDir(config.paths.temp);
    await ensureDir(config.paths.output);
    logger.info('Đã tạo các thư mục cần thiết', 'App');
  } catch (error) {
    logger.error(`Lỗi khi tạo thư mục: ${error.message}`, 'App');
  }
}

// Thêm routes
app.use('/api', routes);

// Route mặc định
app.get('/', (_req, res) => {
  res.json({
    name: 'FFmpeg Wrapper API',
    version: '1.0.0',
    status: 'running'
  });
});

// Middleware xử lý lỗi
app.use((req, res, _next) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Route ${req.method} ${req.url} không tồn tại`
  });
});

app.use((err, _req, res, _next) => {
  logger.error(`Lỗi server: ${err.message}`, 'App');
  res.status(err.status || 500).json({
    error: err.name || 'Internal Server Error',
    message: err.message || 'Đã xảy ra lỗi không xác định'
  });
});

// Khởi động server
const PORT = config.server.port;
const HOST = config.server.host;

async function startServer() {
  try {
    // Đảm bảo các thư mục cần thiết tồn tại
    await ensureDirectories();
    
    // Khởi động server
    app.listen(PORT, HOST, () => {
      logger.info(`Server đang chạy tại http://${HOST}:${PORT}`, 'App');
    });
  } catch (error) {
    logger.error(`Không thể khởi động server: ${error.message}`, 'App');
    process.exit(1);
  }
}

// Xử lý tắt server
process.on('SIGTERM', () => {
  logger.info('Nhận tín hiệu SIGTERM, đang tắt server...', 'App');
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('Nhận tín hiệu SIGINT, đang tắt server...', 'App');
  process.exit(0);
});

// Xử lý lỗi không bắt được
process.on('uncaughtException', (error) => {
  logger.error(`Lỗi không bắt được: ${error.message}`, 'App');
  logger.error(error.stack, 'App');
  process.exit(1);
});

process.on('unhandledRejection', (reason, _promise) => {
  logger.error(`Promise không được xử lý: ${reason}`, 'App');
  process.exit(1);
});

// Export app để sử dụng trong tests
export { app, startServer };

// Khởi động server nếu file được chạy trực tiếp
if (process.env.NODE_ENV !== 'test') {
  startServer();
} 