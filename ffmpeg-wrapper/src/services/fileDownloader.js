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
          reject(new Error(`Lỗi khi đọc file nguồn: ${error.message}`));
        });
        destStream.on('finish', () => {
          resolve();
        });
        destStream.on('error', (error) => {
          reject(new Error(`Lỗi khi ghi file đích: ${error.message}`));
        });
      });
      
      logger.info(`${logPrefix} Đã sao chép file thành công: ${filePath}`, 'FileDownloader');
      return filePath;
    } catch (error) {
      logger.error(`${logPrefix} Lỗi khi sao chép file cục bộ: ${error.message}`, 'FileDownloader');
      throw new Error(`Không thể sao chép file cục bộ: ${error.message}`);
    }
  }
  
  // Xử lý URL từ internet
  let attempt = 0;
  
  while (attempt < retries) {
    attempt++;
    
    try {
      // Kiểm tra URL hợp lệ
      if (!source.startsWith('http://') && !source.startsWith('https://')) {
        throw new Error('URL không hợp lệ, phải bắt đầu bằng http:// hoặc https://');
      }
      
      // Thiết lập timeout cho fetch
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);
      
      const response = await fetch(source, { 
        signal: controller.signal,
        headers: {
          'User-Agent': 'FFmpeg-Wrapper/1.0'
        }
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        throw new Error(`Lỗi HTTP: ${response.status} ${response.statusText}`);
      }
      
      // Tạo stream để lưu file
      const fileStream = fs.createWriteStream(filePath);
      
      await new Promise((resolve, reject) => {
        response.body.pipe(fileStream);
        response.body.on('error', (error) => {
          reject(error);
        });
        fileStream.on('finish', () => {
          resolve();
        });
        fileStream.on('error', (error) => {
          reject(error);
        });
      });
      
      logger.info(`${logPrefix} Đã tải file thành công: ${filePath}`, 'FileDownloader');
      return filePath;
    } catch (error) {
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
      
      // Chờ trước khi thử lại
      await new Promise(resolve => setTimeout(resolve, config.retry.delay * attempt));
    }
  }
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