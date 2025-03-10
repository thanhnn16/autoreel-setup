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
    if (!fs.existsSync(dirPath)) {
      return false;
    }

    const entries = await readdir(dirPath);

    for (const entry of entries) {
      const entryPath = path.join(dirPath, entry);
      const stats = await stat(entryPath);

      if (stats.isDirectory()) {
        await removeDir(entryPath);
      } else {
        await unlink(entryPath);
      }
    }

    await rmdir(dirPath);
    logger.info(`Đã xóa thư mục: ${dirPath}`, 'FileManager');
    return true;
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
    const tempDir = path.join(config.paths.temp, `task_${taskId}`);
    if (fs.existsSync(tempDir)) {
      await removeDir(tempDir);
      logger.info(`[Task ${taskId}] Đã dọn dẹp tài nguyên tạm thời`, 'FileManager');
      return true;
    }
    return false;
  } catch (error) {
    logger.error(`[Task ${taskId}] Không thể dọn dẹp tài nguyên tạm thời: ${error.message}`, 'FileManager');
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

export {
  ensureDir,
  createTempDir,
  removeFile,
  removeDir,
  cleanupTaskResources,
  saveToFile,
  readFromFile,
  generateUniqueFilename
}; 