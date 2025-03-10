/**
 * Module xử lý ghi log
 */
import fs from 'fs';
import path from 'path';
import { format } from 'util';
import config from '../config/index.js';

// Lưu trữ các hàm console gốc
const originalConsoleLog = console.log;
const originalConsoleError = console.error;

// Thiết lập thư mục logs
const logsDir = config.paths.logs;
if (!fs.existsSync(logsDir)) {
  try {
    fs.mkdirSync(logsDir, { recursive: true });
    originalConsoleLog(`Đã tạo thư mục logs: ${path.resolve(logsDir)}`);
  } catch (error) {
    originalConsoleError(`Không thể tạo thư mục logs: ${error.message}`);
  }
}

// Tạo file log cho server
const serverLogFile = path.join(logsDir, 'server.log');

/**
 * Ghi log với level và timestamp
 * @param {string} message - Nội dung log
 * @param {string} level - Level của log (INFO, ERROR, WARN, DEBUG)
 * @param {string} category - Danh mục của log (Server, FFmpeg, Task, etc.)
 */
function writeLog(message, level = 'INFO', category = 'Server') {
  try {
    const timestamp = new Date().toISOString();
    const formattedMessage = `[${timestamp}] [${level}] [${category}] ${message}\n`;

    // Ghi ra console
    if (level === 'ERROR') {
      originalConsoleError(formattedMessage);
    } else {
      originalConsoleLog(formattedMessage);
    }

    // Đảm bảo thư mục logs tồn tại
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }

    // Ghi vào file log
    fs.appendFileSync(serverLogFile, formattedMessage);
  } catch (error) {
    originalConsoleError(`Lỗi khi ghi log: ${error.message}`);
  }
}

/**
 * Ghi log task
 * @param {string} taskId - ID của task
 * @param {object} data - Dữ liệu cần ghi log
 * @param {string} type - Loại log (input, output, error)
 */
function writeTaskLog(taskId, data, type = 'info') {
  try {
    const filename = `${logsDir}/task_${taskId}_${type}.json`;
    fs.writeFileSync(filename, JSON.stringify(data, null, 2));
    writeLog(`[Task ${taskId}] Đã ghi log task ${type}`, 'INFO', 'Task');
  } catch (error) {
    writeLog(`[Task ${taskId}] Không thể ghi log task ${type}: ${error.message}`, 'ERROR', 'Task');
  }
}

// Override console.log và console.error để ghi logs
console.log = function() {
  const message = format.apply(null, arguments);
  writeLog(message, 'INFO');
};

console.error = function() {
  const message = format.apply(null, arguments);
  writeLog(message, 'ERROR');
};

// Các hàm helper
const logger = {
  info: (message, category = 'Server') => writeLog(message, 'INFO', category),
  error: (message, category = 'Server') => writeLog(message, 'ERROR', category),
  warn: (message, category = 'Server') => writeLog(message, 'WARN', category),
  debug: (message, category = 'Server') => writeLog(message, 'DEBUG', category),
  task: {
    info: (taskId, message) => writeLog(`[Task ${taskId}] ${message}`, 'INFO', 'Task'),
    error: (taskId, message) => writeLog(`[Task ${taskId}] ${message}`, 'ERROR', 'Task'),
    warn: (taskId, message) => writeLog(`[Task ${taskId}] ${message}`, 'WARN', 'Task'),
    logData: (taskId, data, type) => writeTaskLog(taskId, data, type)
  }
};

export { 
  writeLog, 
  writeTaskLog,
  originalConsoleLog,
  originalConsoleError
};

export default logger; 