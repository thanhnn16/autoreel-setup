/**
 * Routes quản lý logs
 */
import express from 'express';
import path from 'path';
import fs from 'fs';
import config from '../config/index.js';
import logger from '../utils/logger.js';

const router = express.Router();

/**
 * Route lấy danh sách logs
 */
router.get('/', (req, res) => {
  try {
    const logsDir = config.paths.logs;
    
    if (!fs.existsSync(logsDir)) {
      return res.json({ logs: [] });
    }
    
    const files = fs.readdirSync(logsDir);
    const logFiles = files.filter(file => file.endsWith('.log') || file.endsWith('.json'));
    
    const logs = logFiles.map(file => {
      const filePath = path.join(logsDir, file);
      const stats = fs.statSync(filePath);
      
      return {
        name: file,
        path: filePath,
        size: stats.size,
        created: stats.birthtime,
        modified: stats.mtime
      };
    });
    
    res.json({ logs });
  } catch (error) {
    logger.error(`Lỗi khi lấy danh sách logs: ${error.message}`, 'API');
    res.status(500).json({ error: error.message });
  }
});

/**
 * Route lấy nội dung log
 */
router.get('/:filename', (req, res) => {
  try {
    const filename = req.params.filename;
    const filePath = path.join(config.paths.logs, filename);
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: `File log ${filename} không tồn tại` });
    }
    
    // Kiểm tra xem file có phải là file log hợp lệ không
    if (!filename.endsWith('.log') && !filename.endsWith('.json')) {
      return res.status(400).json({ error: 'Chỉ hỗ trợ file .log và .json' });
    }
    
    const content = fs.readFileSync(filePath, 'utf8');
    
    // Nếu là file JSON, parse và trả về dưới dạng JSON
    if (filename.endsWith('.json')) {
      try {
        const jsonContent = JSON.parse(content);
        res.json(jsonContent);
      } catch (jsonError) {
        res.send(content);
      }
    } else {
      // Nếu là file log thông thường, trả về dưới dạng text
      res.send(content);
    }
  } catch (error) {
    logger.error(`Lỗi khi đọc file log: ${error.message}`, 'API');
    res.status(500).json({ error: error.message });
  }
});

/**
 * Route lấy log của task cụ thể
 */
router.get('/task/:id', (req, res) => {
  try {
    const taskId = req.params.id;
    const logsDir = config.paths.logs;
    
    if (!fs.existsSync(logsDir)) {
      return res.json({ logs: [] });
    }
    
    const files = fs.readdirSync(logsDir);
    const taskLogFiles = files.filter(file => file.includes(`task_${taskId}`));
    
    if (taskLogFiles.length === 0) {
      return res.status(404).json({ error: `Không tìm thấy log cho task ${taskId}` });
    }
    
    const logs = {};
    
    taskLogFiles.forEach(file => {
      const filePath = path.join(logsDir, file);
      const content = fs.readFileSync(filePath, 'utf8');
      
      // Xác định loại log từ tên file
      let logType = 'unknown';
      if (file.includes('_input')) logType = 'input';
      else if (file.includes('_output')) logType = 'output';
      else if (file.includes('_error')) logType = 'error';
      
      // Nếu là file JSON, parse và thêm vào kết quả
      if (file.endsWith('.json')) {
        try {
          logs[logType] = JSON.parse(content);
        } catch (jsonError) {
          logs[logType] = content;
        }
      } else {
        logs[logType] = content;
      }
    });
    
    res.json({ taskId, logs });
  } catch (error) {
    logger.error(`Lỗi khi lấy log task: ${error.message}`, 'API');
    res.status(500).json({ error: error.message });
  }
});

/**
 * Route xóa log
 */
router.delete('/:filename', (req, res) => {
  try {
    const filename = req.params.filename;
    const filePath = path.join(config.paths.logs, filename);
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: `File log ${filename} không tồn tại` });
    }
    
    // Kiểm tra xem file có phải là file log hợp lệ không
    if (!filename.endsWith('.log') && !filename.endsWith('.json')) {
      return res.status(400).json({ error: 'Chỉ hỗ trợ xóa file .log và .json' });
    }
    
    fs.unlinkSync(filePath);
    
    res.json({ 
      success: true, 
      message: `Đã xóa file log ${filename}` 
    });
  } catch (error) {
    logger.error(`Lỗi khi xóa file log: ${error.message}`, 'API');
    res.status(500).json({ error: error.message });
  }
});

export default router; 