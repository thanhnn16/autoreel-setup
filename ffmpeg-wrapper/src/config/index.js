/**
 * Cấu hình chung cho ứng dụng
 */

import ffmpegConfig from './ffmpeg.js';

export default {
  // Cấu hình FFmpeg
  ffmpeg: ffmpegConfig,
  
  // Cấu hình server
  server: {
    port: process.env.PORT || 3000,
    host: process.env.HOST || 'localhost',
  },
  
  // Cấu hình đường dẫn
  paths: {
    logs: './logs',
    temp: './temp',
    output: './output',
    fonts: './fonts',
  },
  
  // Cấu hình timeout
  timeouts: {
    task: 30 * 60 * 1000, // 30 phút
    download: 5 * 60 * 1000, // 5 phút
    // ffmpeg timeout đã được chuyển sang file ffmpeg.js
  },
  
  // Cấu hình retry
  retry: {
    maxAttempts: 3,
    delay: 1000,
  },

  // Cấu hình xử lý
  processing: {
    cleanup: true, // Có xóa file tạm sau khi xử lý xong không
    keepLogs: true, // Có giữ lại log không
    maxRetries: 3, // Số lần thử lại tối đa khi xử lý thất bại
    retryDelay: 1000, // Thời gian chờ giữa các lần thử lại (ms)
    overwriteOutput: true, // Có ghi đè file đầu ra nếu đã tồn tại không
  }
}; 