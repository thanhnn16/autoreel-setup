/**
 * Cấu hình chung cho ứng dụng
 */

export default {
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
    ffmpeg: 20 * 60 * 1000, // 20 phút
  },
  
  // Cấu hình retry
  retry: {
    maxAttempts: 3,
    delay: 1000,
  },
}; 