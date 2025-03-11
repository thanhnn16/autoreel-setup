/**
 * Module quản lý file và thư mục
 */
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import config from '../config/index.js';
import logger from './logger.js';

// Promisify các hàm fs
const mkdir = promisify(fs.mkdir);
const writeFile = promisify(fs.writeFile);
const readFile = promisify(fs.readFile);
const unlink = promisify(fs.unlink);
const rmdir = promisify(fs.rmdir);
const readdir = promisify(fs.readdir);
const stat = promisify(fs.stat);

/**
 * Đảm bảo thư mục tồn tại, tạo nếu chưa có
 * @param {string} dirPath - Đường dẫn thư mục
 * @returns {Promise<string>} - Đường dẫn thư mục đã tạo
 */
async function ensureDir(dirPath) {
  try {
    if (!fs.existsSync(dirPath)) {
      await mkdir(dirPath, { recursive: true });
      logger.info(`Đã tạo thư mục: ${path.resolve(dirPath)}`, 'FileManager');
    }
    return dirPath;
  } catch (error) {
    logger.error(`Không thể tạo thư mục ${dirPath}: ${error.message}`, 'FileManager');
    throw error;
  }
}

/**
 * Tạo thư mục tạm thời cho task
 * @param {string} taskId - ID của task
 * @returns {Promise<string>} - Đường dẫn thư mục tạm thời
 */
async function createTempDir(taskId) {
  const tempDir = path.join(config.paths.temp, `task_${taskId}`);
  await ensureDir(tempDir);
  return tempDir;
}

/**
 * Xóa file nếu tồn tại
 * @param {string} filePath - Đường dẫn file cần xóa
 * @returns {Promise<boolean>} - true nếu xóa thành công, false nếu file không tồn tại
 */
async function removeFile(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      await unlink(filePath);
      logger.info(`Đã xóa file: ${filePath}`, 'FileManager');
      return true;
    }
    return false;
  } catch (error) {
    logger.error(`Không thể xóa file ${filePath}: ${error.message}`, 'FileManager');
    throw error;
  }
}

/**
 * Xóa thư mục và tất cả nội dung bên trong
 * @param {string} dirPath - Đường dẫn thư mục cần xóa
 * @returns {Promise<boolean>} - true nếu xóa thành công
 */
async function removeDir(dirPath) {
  try {
    // Kiểm tra xem dirPath có phải là string không
    if (!dirPath || typeof dirPath !== 'string') {
      logger.error(`Đường dẫn không hợp lệ: ${dirPath}`, 'FileManager');
      throw new Error('Path must be a string');
    }
    
    if (!fs.existsSync(dirPath)) {
      logger.debug(`Thư mục không tồn tại: ${dirPath}`, 'FileManager');
      return false;
    }

    // Kiểm tra xem đường dẫn có phải là thư mục không
    const stats = await stat(dirPath);
    if (!stats.isDirectory()) {
      logger.warn(`Đường dẫn không phải là thư mục: ${dirPath}`, 'FileManager');
      return false;
    }

    const entries = await readdir(dirPath);
    logger.debug(`Đang xóa thư mục ${dirPath} với ${entries.length} mục`, 'FileManager');

    // Xóa từng mục trong thư mục
    for (const entry of entries) {
      const entryPath = path.join(dirPath, entry);
      try {
        const entryStats = await stat(entryPath);

        if (entryStats.isDirectory()) {
          // Đệ quy xóa thư mục con
          await removeDir(entryPath);
        } else {
          // Xóa file
          await unlink(entryPath);
          logger.debug(`Đã xóa file: ${entryPath}`, 'FileManager');
        }
      } catch (entryError) {
        logger.warn(`Không thể xóa mục ${entryPath}: ${entryError.message}`, 'FileManager');
        
        // Thử xóa với fs.unlinkSync và force
        try {
          fs.unlinkSync(entryPath, { force: true });
          logger.debug(`Đã xóa file với force: ${entryPath}`, 'FileManager');
        } catch (forceError) {
          logger.error(`Không thể xóa file với force: ${forceError.message}`, 'FileManager');
        }
      }
    }

    // Kiểm tra lại xem thư mục đã trống chưa
    const remainingEntries = await readdir(dirPath);
    if (remainingEntries.length > 0) {
      logger.warn(`Thư mục vẫn còn ${remainingEntries.length} mục sau khi cố gắng xóa: ${dirPath}`, 'FileManager');
      logger.debug(`Các mục còn lại: ${remainingEntries.join(', ')}`, 'FileManager');
      
      // Thử xóa lại từng mục với force
      for (const entry of remainingEntries) {
        const entryPath = path.join(dirPath, entry);
        try {
          const entryStats = await stat(entryPath);
          if (entryStats.isDirectory()) {
            // Thử xóa thư mục với fs.rmdirSync
            fs.rmdirSync(entryPath, { recursive: true, force: true });
          } else {
            // Thử xóa file với fs.unlinkSync
            fs.unlinkSync(entryPath);
          }
          logger.debug(`Đã xóa mục với force: ${entryPath}`, 'FileManager');
        } catch (forceError) {
          logger.error(`Không thể xóa mục với force ${entryPath}: ${forceError.message}`, 'FileManager');
        }
      }
    }

    // Xóa thư mục gốc
    try {
      await rmdir(dirPath);
      logger.info(`Đã xóa thư mục: ${dirPath}`, 'FileManager');
      return true;
    } catch (rmdirError) {
      logger.warn(`Không thể xóa thư mục với rmdir: ${rmdirError.message}`, 'FileManager');
      
      // Thử xóa với fs.rmdirSync và force
      try {
        fs.rmdirSync(dirPath, { recursive: true, force: true });
        logger.info(`Đã xóa thư mục với force: ${dirPath}`, 'FileManager');
        return true;
      } catch (forceError) {
        logger.error(`Không thể xóa thư mục với force: ${forceError.message}`, 'FileManager');
        
        // Thử một lần cuối với fs.rm (Node.js >= 14.14.0)
        try {
          if (typeof fs.rm === 'function') {
            fs.rmSync(dirPath, { recursive: true, force: true });
            logger.info(`Đã xóa thư mục với fs.rmSync: ${dirPath}`, 'FileManager');
            return true;
          } else {
            throw new Error('fs.rm không khả dụng');
          }
        } catch (rmError) {
          logger.error(`Không thể xóa thư mục với fs.rmSync: ${rmError.message}`, 'FileManager');
          throw rmError;
        }
      }
    }
  } catch (error) {
    logger.error(`Không thể xóa thư mục ${dirPath}: ${error.message}`, 'FileManager');
    throw error;
  }
}

/**
 * Dọn dẹp tài nguyên tạm thời của task
 * @param {string} taskId - ID của task
 * @returns {Promise<boolean>} - true nếu dọn dẹp thành công
 */
async function cleanupTaskResources(taskId) {
  try {
    if (!taskId) {
      logger.warn('Không thể dọn dẹp tài nguyên tạm: taskId không được cung cấp', 'FileManager');
      return false;
    }
    
    // Kiểm tra xem config.paths.temp có tồn tại không
    if (!config.paths || !config.paths.temp) {
      logger.warn(`Không thể dọn dẹp tài nguyên tạm cho task ${taskId}: config.paths.temp không được định nghĩa`, 'FileManager');
      return false;
    }
    
    const tempDir = path.join(config.paths.temp, `task_${taskId}`);
    if (!fs.existsSync(tempDir)) {
      logger.info(`[Task ${taskId}] Thư mục tạm không tồn tại: ${tempDir}`, 'FileManager');
      return true; // Không có gì để dọn dẹp
    }
    
    logger.info(`[Task ${taskId}] Bắt đầu dọn dẹp tài nguyên tạm thời tại ${tempDir}`, 'FileManager');
    
    // Kiểm tra xem thư mục có trống không
    let entries = [];
    try {
      entries = await readdir(tempDir);
    } catch (readdirError) {
      logger.warn(`[Task ${taskId}] Không thể đọc thư mục tạm: ${readdirError.message}`, 'FileManager');
      return false;
    }
    
    if (entries.length > 0) {
      logger.info(`[Task ${taskId}] Thư mục tạm có ${entries.length} mục, đang xóa từng mục...`, 'FileManager');
      
      // Liệt kê các mục trong thư mục
      for (const entry of entries) {
        logger.debug(`[Task ${taskId}] Tìm thấy mục: ${entry}`, 'FileManager');
      }
    }
    
    // Sử dụng hàm removeDir để xóa thư mục và nội dung bên trong
    try {
      const result = await removeDir(tempDir);
      
      if (result) {
        logger.info(`[Task ${taskId}] Đã dọn dẹp tài nguyên tạm thời`, 'FileManager');
      } else {
        logger.warn(`[Task ${taskId}] Không thể xóa thư mục tạm`, 'FileManager');
        
        // Thử xóa thủ công từng file
        try {
          for (const entry of entries) {
            const entryPath = path.join(tempDir, entry);
            try {
              const stats = await stat(entryPath);
              
              if (stats.isDirectory()) {
                await removeDir(entryPath);
                logger.debug(`[Task ${taskId}] Đã xóa thư mục con: ${entryPath}`, 'FileManager');
              } else {
                await unlink(entryPath);
                logger.debug(`[Task ${taskId}] Đã xóa file: ${entryPath}`, 'FileManager');
              }
            } catch (entryError) {
              logger.warn(`[Task ${taskId}] Không thể xóa mục ${entryPath}: ${entryError.message}`, 'FileManager');
              
              // Thử xóa với force
              try {
                if (fs.existsSync(entryPath)) {
                  const entryStat = fs.statSync(entryPath);
                  if (entryStat.isDirectory()) {
                    fs.rmdirSync(entryPath, { recursive: true, force: true });
                  } else {
                    fs.unlinkSync(entryPath, { force: true });
                  }
                  logger.debug(`[Task ${taskId}] Đã xóa mục với force: ${entryPath}`, 'FileManager');
                }
              } catch (forceError) {
                logger.error(`[Task ${taskId}] Không thể xóa mục với force: ${forceError.message}`, 'FileManager');
              }
            }
          }
          
          // Thử xóa thư mục gốc một lần nữa
          try {
            await rmdir(tempDir);
            logger.info(`[Task ${taskId}] Đã xóa thư mục tạm sau khi xóa thủ công từng mục`, 'FileManager');
            return true;
          } catch (rmdirError) {
            logger.warn(`[Task ${taskId}] Không thể xóa thư mục với rmdir: ${rmdirError.message}`, 'FileManager');
            
            // Thử xóa với fs.rmdirSync và force
            try {
              fs.rmdirSync(tempDir, { recursive: true, force: true });
              logger.info(`[Task ${taskId}] Đã xóa thư mục tạm với force`, 'FileManager');
              return true;
            } catch (forceError) {
              logger.error(`[Task ${taskId}] Không thể xóa thư mục tạm với force: ${forceError.message}`, 'FileManager');
              
              // Thử một lần cuối với fs.rm (Node.js >= 14.14.0)
              if (typeof fs.rm === 'function') {
                try {
                  fs.rmSync(tempDir, { recursive: true, force: true });
                  logger.info(`[Task ${taskId}] Đã xóa thư mục tạm với fs.rmSync`, 'FileManager');
                  return true;
                } catch (rmError) {
                  logger.error(`[Task ${taskId}] Không thể xóa thư mục tạm với fs.rmSync: ${rmError.message}`, 'FileManager');
                }
              }
              
              return false;
            }
          }
        } catch (innerError) {
          logger.error(`[Task ${taskId}] Không thể xóa thủ công: ${innerError.message}`, 'FileManager');
          return false;
        }
      }
      
      return result;
    } catch (removeError) {
      logger.error(`[Task ${taskId}] Lỗi khi xóa thư mục tạm: ${removeError.message}`, 'FileManager');
      return false;
    }
  } catch (error) {
    logger.error(`Lỗi khi dọn dẹp tài nguyên tạm cho task ${taskId}: ${error.message}`, 'FileManager');
    return false;
  }
}

/**
 * Lưu dữ liệu vào file
 * @param {string} filePath - Đường dẫn file
 * @param {string|Buffer} data - Dữ liệu cần lưu
 * @returns {Promise<string>} - Đường dẫn file đã lưu
 */
async function saveToFile(filePath, data) {
  try {
    // Đảm bảo thư mục cha tồn tại
    const dirPath = path.dirname(filePath);
    await ensureDir(dirPath);

    // Ghi file
    await writeFile(filePath, data);
    logger.info(`Đã lưu file: ${filePath}`, 'FileManager');
    return filePath;
  } catch (error) {
    logger.error(`Không thể lưu file ${filePath}: ${error.message}`, 'FileManager');
    throw error;
  }
}

/**
 * Đọc nội dung file
 * @param {string} filePath - Đường dẫn file
 * @param {string} encoding - Encoding (mặc định là utf8)
 * @returns {Promise<string|Buffer>} - Nội dung file
 */
async function readFromFile(filePath, encoding = 'utf8') {
  try {
    if (!fs.existsSync(filePath)) {
      throw new Error(`File không tồn tại: ${filePath}`);
    }
    return await readFile(filePath, encoding);
  } catch (error) {
    logger.error(`Không thể đọc file ${filePath}: ${error.message}`, 'FileManager');
    throw error;
  }
}

/**
 * Tạo tên file duy nhất dựa trên timestamp
 * @param {string} prefix - Tiền tố cho tên file
 * @param {string} extension - Phần mở rộng của file (không bao gồm dấu chấm)
 * @returns {string} - Tên file duy nhất
 */
function generateUniqueFilename(prefix = '', extension = '') {
  const timestamp = Date.now();
  const random = Math.floor(Math.random() * 10000);
  const ext = extension ? `.${extension}` : '';
  return `${prefix}${timestamp}_${random}${ext}`;
}

/**
 * Đảm bảo thư mục output tồn tại và có quyền ghi
 * @param {string} outputPath - Đường dẫn file đầu ra
 * @returns {Promise<boolean>} - true nếu thư mục output hợp lệ
 */
async function ensureOutputDir(outputPath) {
  try {
    // Đảm bảo outputPath là đường dẫn thư mục, không phải đường dẫn file
    const outputDir = fs.statSync(outputPath)?.isDirectory() ? outputPath : path.dirname(outputPath);
    
    // Đảm bảo thư mục đầu ra tồn tại
    await ensureDir(outputDir);
    
    // Kiểm tra quyền ghi vào thư mục đầu ra
    try {
      const testFile = path.join(outputDir, `test_${Date.now()}.txt`);
      fs.writeFileSync(testFile, 'test');
      fs.unlinkSync(testFile);
      logger.info(`Thư mục đầu ra hợp lệ: ${outputDir}`, 'FileManager');
      return true;
    } catch (testError) {
      logger.error(`Không thể ghi vào thư mục đầu ra ${outputDir}: ${testError.message}`, 'FileManager');
      return false;
    }
  } catch (error) {
    // Nếu outputPath không tồn tại, giả định nó là đường dẫn thư mục
    try {
      const outputDir = path.dirname(outputPath);
      await ensureDir(outputDir);
      
      // Kiểm tra quyền ghi
      const testFile = path.join(outputDir, `test_${Date.now()}.txt`);
      fs.writeFileSync(testFile, 'test');
      fs.unlinkSync(testFile);
      logger.info(`Thư mục đầu ra hợp lệ: ${outputDir}`, 'FileManager');
      return true;
    } catch (innerError) {
      logger.error(`Không thể đảm bảo thư mục đầu ra: ${innerError.message}`, 'FileManager');
      return false;
    }
  }
}

export {
  ensureDir,
  createTempDir,
  removeFile,
  removeDir,
  cleanupTaskResources,
  saveToFile,
  readFromFile,
  generateUniqueFilename,
  ensureOutputDir
}; 