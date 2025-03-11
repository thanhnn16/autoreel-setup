/**
 * Module xử lý các tác vụ liên quan đến FFmpeg và FFprobe
 */
import { spawn } from 'child_process';
import config from '../config/index.js';
import ffmpegConfig from '../config/ffmpeg.js';
import logger, {  } from './logger.js';
import fs from 'fs';

/**
 * Chạy lệnh FFmpeg và trả về Promise
 * @param {Array} args - Mảng các tham số dòng lệnh cho FFmpeg
 * @param {Object} options - Các tùy chọn bổ sung
 * @returns {Promise<Object>} - Promise chứa kết quả stdout, stderr và code
 */
function runFFmpeg(args, options = {}) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const logPrefix = options.taskId ? `[Task ${options.taskId}] [FFmpeg]` : '[FFmpeg]';
    
    // Xử lý đường dẫn trên Windows
    const processedArgs = args.map(arg => {
      // Nếu arg là đường dẫn file, đảm bảo sử dụng dấu gạch chéo thuận (/)
      if (typeof arg === 'string') {
        return arg.replace(/\\/g, '/');
      }
      return arg;
    });
    
    // Kiểm tra đường dẫn đầu ra
    const outputIndex = processedArgs.findIndex(arg => !arg.startsWith('-'));
    if (outputIndex > 0 && outputIndex === processedArgs.length - 1) {
      const outputPath = processedArgs[outputIndex];
      const outputDir = outputPath.substring(0, outputPath.lastIndexOf('/'));
      
      // Đảm bảo thư mục đầu ra tồn tại
      try {
        if (!fs.existsSync(outputDir)) {
          logger.info(`${logPrefix} Tạo thư mục đầu ra: ${outputDir}`, 'FFmpeg');
          fs.mkdirSync(outputDir, { recursive: true });
        }
      } catch (error) {
        logger.error(`${logPrefix} Không thể tạo thư mục đầu ra ${outputDir}: ${error.message}`, 'FFmpeg');
      }
    }
    
    // Log lệnh FFmpeg
    logger.info(`${logPrefix} Bắt đầu thực thi lệnh: ffmpeg ${processedArgs.join(' ')}`, 'FFmpeg');

    // Thiết lập timeout
    const timeout = options.timeout || ffmpegConfig.timeout;
    let timeoutId;
    
    if (timeout) {
      timeoutId = setTimeout(() => {
        if (ffmpeg && !ffmpeg.killed) {
          ffmpeg.kill('SIGTERM');
          const duration = (Date.now() - startTime) / 1000;
          const errorMsg = `${logPrefix} Quá trình xử lý bị timeout sau ${duration}s`;
          logger.error(errorMsg, 'FFmpeg');
          reject(new Error(errorMsg));
        }
      }, timeout);
    }

    // Khởi chạy FFmpeg
    const ffmpeg = spawn(ffmpegConfig.ffmpegPath, processedArgs);
    let stdout = '';
    let stderr = '';

    ffmpeg.stdout.on('data', (data) => {
      const chunk = data.toString();
      stdout += chunk;
    });

    ffmpeg.stderr.on('data', (data) => {
      const chunk = data.toString();
      stderr += chunk;
      
      // FFmpeg thường ghi log vào stderr, kể cả khi không có lỗi
      // Chỉ log ra các thông báo lỗi quan trọng
      if (chunk.includes('Error') || chunk.includes('error') || chunk.includes('failed')) {
        logger.error(`${logPrefix} stderr: ${chunk}`, 'FFmpeg');
      }
    });

    ffmpeg.on('error', (error) => {
      const duration = (Date.now() - startTime) / 1000;
      logger.error(`${logPrefix} Lỗi khi khởi chạy process (${duration}s): ${error.message}`, 'FFmpeg');
      
      if (timeoutId) clearTimeout(timeoutId);
      reject(error);
    });

    ffmpeg.on('close', (code) => {
      const duration = (Date.now() - startTime) / 1000;
      
      if (timeoutId) clearTimeout(timeoutId);
      
      if (code === 0) {
        logger.info(`${logPrefix} Hoàn thành thành công sau ${duration}s`, 'FFmpeg');
        
        // Kiểm tra file đầu ra nếu có
        if (outputIndex > 0 && outputIndex === processedArgs.length - 1) {
          const outputPath = processedArgs[outputIndex];
          try {
            if (fs.existsSync(outputPath)) {
              const stats = fs.statSync(outputPath);
              logger.info(`${logPrefix} File đầu ra: ${outputPath} (${stats.size} bytes)`, 'FFmpeg');
            } else {
              logger.warn(`${logPrefix} File đầu ra không tồn tại: ${outputPath}`, 'FFmpeg');
            }
          } catch (error) {
            logger.warn(`${logPrefix} Không thể kiểm tra file đầu ra: ${error.message}`, 'FFmpeg');
          }
        }
        
        resolve({ stdout, stderr, code });
      } else {
        const errorMsg = `${logPrefix} Quá trình xử lý thất bại với mã lỗi ${code} sau ${duration}s`;
        logger.error(errorMsg, 'FFmpeg');
        logger.error(`${logPrefix} stderr: ${stderr}`, 'FFmpeg');
        reject(new Error(errorMsg));
      }
    });
  });
}

/**
 * Chạy lệnh FFprobe và trả về Promise
 * @param {Array} args - Mảng các tham số dòng lệnh cho FFprobe
 * @param {Object} options - Các tùy chọn bổ sung
 * @returns {Promise<Object>} - Promise chứa kết quả stdout, stderr và code
 */
function runFFprobe(args, options = {}) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const logPrefix = options.taskId ? `[Task ${options.taskId}] [FFprobe]` : '[FFprobe]';
    
    // Log lệnh FFprobe
    logger.info(`${logPrefix} Bắt đầu thực thi lệnh: ffprobe ${args.join(' ')}`, 'FFprobe');

    // Thiết lập timeout
    const timeout = options.timeout || ffmpegConfig.probeTimeout;
    let timeoutId;
    
    if (timeout) {
      timeoutId = setTimeout(() => {
        if (ffprobe && !ffprobe.killed) {
          ffprobe.kill('SIGTERM');
          const duration = (Date.now() - startTime) / 1000;
          const errorMsg = `${logPrefix} Quá trình xử lý bị timeout sau ${duration}s`;
          logger.error(errorMsg, 'FFprobe');
          reject(new Error(errorMsg));
        }
      }, timeout);
    }

    // Khởi chạy FFprobe
    const ffprobe = spawn(ffmpegConfig.ffprobePath, args);
    let stdout = '';
    let stderr = '';

    ffprobe.stdout.on('data', (data) => {
      const chunk = data.toString();
      stdout += chunk;
    });

    ffprobe.stderr.on('data', (data) => {
      const chunk = data.toString();
      stderr += chunk;
      
      // Log lỗi quan trọng
      if (chunk.includes('Error') || chunk.includes('error') || chunk.includes('failed')) {
        logger.error(`${logPrefix} stderr: ${chunk}`, 'FFprobe');
      }
    });

    ffprobe.on('error', (error) => {
      const duration = (Date.now() - startTime) / 1000;
      logger.error(`${logPrefix} Lỗi khi khởi chạy process (${duration}s): ${error.message}`, 'FFprobe');
      
      if (timeoutId) clearTimeout(timeoutId);
      reject(error);
    });

    ffprobe.on('close', (code) => {
      const duration = (Date.now() - startTime) / 1000;
      
      if (timeoutId) clearTimeout(timeoutId);
      
      if (code === 0) {
        logger.info(`${logPrefix} Hoàn thành thành công sau ${duration}s`, 'FFprobe');
        resolve({ stdout, stderr, code });
      } else {
        const errorMsg = `${logPrefix} Quá trình xử lý thất bại với mã lỗi ${code} sau ${duration}s`;
        logger.error(errorMsg, 'FFprobe');
        logger.error(`${logPrefix} stderr: ${stderr}`, 'FFprobe');
        reject(new Error(errorMsg));
      }
    });
  });
}

/**
 * Định dạng thời gian cho ASS
 * @param {number} seconds - Số giây
 * @returns {string} - Chuỗi thời gian định dạng h:mm:ss.cc
 */
function formatAssTime(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 100);
  
  return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
}

export {
  runFFmpeg,
  runFFprobe,
  formatAssTime
}; 