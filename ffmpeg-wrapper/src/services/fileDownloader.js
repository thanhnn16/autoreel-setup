/**
 * Service xử lý tải file
 */
import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import config from '../config/index.js';
import logger from '../utils/logger.js';
import { ensureDir } from '../utils/fileManager.js';

/**
 * Tải file từ URL hoặc sao chép từ đường dẫn cục bộ
 * @param {string} source - URL hoặc đường dẫn cục bộ của file
 * @param {string} filePath - Đường dẫn lưu file
 * @param {Object} options - Các tùy chọn bổ sung
 * @returns {Promise<string>} - Đường dẫn file đã tải
 */
async function downloadFile(source, filePath, options = {}) {
  const { taskId, timeout = config.timeouts.download, retries = config.retry.maxAttempts } = options;
  const logPrefix = taskId ? `[Task ${taskId}]` : '';
  
  logger.info(`${logPrefix} Bắt đầu tải file từ ${source}`, 'FileDownloader');
  
  // Đảm bảo thư mục cha tồn tại
  const dirPath = path.dirname(filePath);
  await ensureDir(dirPath);
  
  // Kiểm tra xem source có phải là đường dẫn cục bộ không
  if (source.startsWith('mock/') || source.startsWith('./mock/') || fs.existsSync(source)) {
    try {
      // Đây là file cục bộ, sao chép nó
      logger.info(`${logPrefix} Phát hiện đường dẫn cục bộ: ${source}`, 'FileDownloader');
      
      // Tạo stream để sao chép file
      const sourceStream = fs.createReadStream(source);
      const destStream = fs.createWriteStream(filePath);
      
      await new Promise((resolve, reject) => {
        sourceStream.pipe(destStream);
        sourceStream.on('error', (error) => {
          destStream.end();
          reject(new Error(`Lỗi khi đọc file nguồn: ${error.message}`));
        });
        destStream.on('finish', () => {
          resolve();
        });
        destStream.on('error', (error) => {
          sourceStream.destroy();
          reject(new Error(`Lỗi khi ghi file đích: ${error.message}`));
        });
      });
      
      // Kiểm tra kích thước file sau khi sao chép
      const sourceStats = fs.statSync(source);
      const destStats = fs.statSync(filePath);
      if (sourceStats.size !== destStats.size) {
        throw new Error(`Kích thước file không khớp sau khi sao chép: ${sourceStats.size} != ${destStats.size}`);
      }
      
      logger.info(`${logPrefix} Đã sao chép file thành công: ${filePath}`, 'FileDownloader');
      return filePath;
    } catch (error) {
      logger.error(`${logPrefix} Lỗi khi sao chép file cục bộ: ${error.message}`, 'FileDownloader');
      throw new Error(`Không thể sao chép file cục bộ: ${error.message}`);
    }
  }
  
  // Xử lý URL từ internet
  let attempt = 0;
  let lastError = null;
  
  while (attempt < retries) {
    attempt++;
    let controller = new AbortController();
    let timeoutId = null;
    let fileStream = null;
    
    try {
      // Kiểm tra URL hợp lệ
      if (!source.startsWith('http://') && !source.startsWith('https://')) {
        throw new Error('URL không hợp lệ, phải bắt đầu bằng http:// hoặc https://');
      }
      
      // Thiết lập timeout cho fetch
      timeoutId = setTimeout(() => {
        controller.abort();
        if (fileStream) fileStream.destroy();
      }, timeout);
      
      const response = await fetch(source, { 
        signal: controller.signal,
        headers: {
          'User-Agent': 'FFmpeg-Wrapper/1.0',
          'Accept': '*/*'
        }
      });
      
      if (!response.ok) {
        throw new Error(`Lỗi HTTP: ${response.status} ${response.statusText}`);
      }
      
      // Lấy kích thước file từ header
      const contentLength = parseInt(response.headers.get('content-length'));
      let downloadedSize = 0;
      
      // Kiểm tra loại file và phương pháp tải
      const contentType = response.headers.get('content-type') || '';
      const isVideoFile = contentType.includes('video') || 
                         source.toLowerCase().endsWith('.mp4') || 
                         source.toLowerCase().endsWith('.mov');
      
      // Nếu là file video, lưu toàn bộ file vào bộ nhớ trước, sau đó xử lý
      if (isVideoFile) {
        logger.info(`${logPrefix} Phát hiện file video, sử dụng phương pháp tải đặc biệt`, 'FileDownloader');
        
        try {
          // Tải toàn bộ file vào bộ nhớ
          const buffer = await response.arrayBuffer();
          
          // Ghi file từ buffer
          await fs.promises.writeFile(filePath, Buffer.from(buffer));
          
          // Kiểm tra kích thước file
          const stats = fs.statSync(filePath);
          if (contentLength && stats.size !== contentLength) {
            throw new Error(`Kích thước file không khớp sau khi tải: ${stats.size}/${contentLength} bytes`);
          }
          
          logger.info(`${logPrefix} Đã tải file video thành công: ${filePath}`, 'FileDownloader');
          return filePath;
        } catch (bufferError) {
          logger.error(`${logPrefix} Lỗi khi tải file video vào bộ nhớ: ${bufferError.message}`, 'FileDownloader');
          throw bufferError;
        }
      }
      
      // Phương pháp tải thông thường bằng stream cho các file khác
      fileStream = fs.createWriteStream(filePath);
      
      await new Promise((resolve, reject) => {
        response.body.on('data', (chunk) => {
          downloadedSize += chunk.length;
          if (contentLength) {
            const progress = Math.round((downloadedSize / contentLength) * 100);
            logger.debug(`${logPrefix} Tiến độ tải: ${progress}%`, 'FileDownloader');
          }
        });
        
        response.body.pipe(fileStream);
        
        response.body.on('error', (error) => {
          fileStream.destroy();
          reject(error);
        });
        
        fileStream.on('finish', () => {
          // Kiểm tra kích thước file đã tải
          if (contentLength && downloadedSize !== contentLength) {
            reject(new Error(`File tải không đầy đủ: ${downloadedSize}/${contentLength} bytes`));
          } else {
            resolve();
          }
        });
        
        fileStream.on('error', (error) => {
          response.body.destroy();
          reject(error);
        });
      });
      
      // Xóa timeout nếu tải thành công
      clearTimeout(timeoutId);
      
      // Kiểm tra file đã tải
      const stats = fs.statSync(filePath);
      if (contentLength && stats.size !== contentLength) {
        throw new Error(`Kích thước file không khớp sau khi tải: ${stats.size}/${contentLength} bytes`);
      }
      
      logger.info(`${logPrefix} Đã tải file thành công: ${filePath}`, 'FileDownloader');
      return filePath;
      
    } catch (error) {
      // Cleanup resources
      clearTimeout(timeoutId);
      if (fileStream) {
        fileStream.destroy();
        // Xóa file tạm nếu tải không thành công
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      }
      
      lastError = error;
      const isLastAttempt = attempt >= retries;
      const logLevel = isLastAttempt ? 'error' : 'warn';
      
      logger.info(
        `${logPrefix} Lỗi khi tải file (lần thử ${attempt}/${retries}): ${error.message}`,
        'FileDownloader',
        logLevel
      );
      
      if (isLastAttempt) {
        throw new Error(`Không thể tải file sau ${retries} lần thử: ${error.message}`);
      }
      
      // Chờ trước khi thử lại với thời gian tăng dần
      const delay = config.retry.delay * Math.pow(2, attempt - 1);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  throw lastError || new Error('Không thể tải file sau nhiều lần thử');
}

/**
 * Tải nhiều file từ mảng URL
 * @param {Array<string>} urls - Mảng các URL cần tải
 * @param {string} outputDir - Thư mục đích
 * @param {Object} options - Các tùy chọn bổ sung
 * @returns {Promise<Array<string>>} - Mảng đường dẫn các file đã tải
 */
async function downloadMultipleFiles(urls, outputDir, options = {}) {
  const { taskId, filePrefix = '', fileExtension = '' } = options;
  const logPrefix = taskId ? `[Task ${taskId}]` : '';
  
  logger.info(`${logPrefix} Bắt đầu tải ${urls.length} files`, 'FileDownloader');
  
  // Đảm bảo thư mục đích tồn tại
  await ensureDir(outputDir);
  
  const downloadPromises = urls.map(async (url, index) => {
    try {
      const filename = `${filePrefix}${index + 1}${fileExtension ? `.${fileExtension}` : path.extname(url) || ''}`;
      const filePath = path.join(outputDir, filename);
      
      return await downloadFile(url, filePath, options);
    } catch (error) {
      logger.error(`${logPrefix} Lỗi khi tải file ${url}: ${error.message}`, 'FileDownloader');
      throw error;
    }
  });
  
  const results = await Promise.all(downloadPromises);
  logger.info(`${logPrefix} Đã tải thành công ${results.length} files`, 'FileDownloader');
  
  return results;
}

export {
  downloadFile,
  downloadMultipleFiles
};