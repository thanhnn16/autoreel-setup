/**
 * Routes xử lý video
 */
import express from 'express';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { processTask } from '../services/videoProcessor.js';
import { runFFmpeg, runFFprobe } from '../utils/ffmpeg.js';
import logger from '../utils/logger.js';
import config from '../config/index.js';

const router = express.Router();

/**
 * Middleware kiểm tra dữ liệu đầu vào
 */
function validateTaskInput(req, res, next) {
  const { id, images, durations, voiceUrl } = req.body;
  
  if (!id) {
    return res.status(400).json({ error: 'Thiếu trường id' });
  }
  
  if (!images || !Array.isArray(images) || images.length === 0) {
    return res.status(400).json({ error: 'Trường images phải là một mảng không rỗng' });
  }
  
  if (!durations || !Array.isArray(durations) || durations.length === 0) {
    return res.status(400).json({ error: 'Trường durations phải là một mảng không rỗng' });
  }
  
  if (images.length !== durations.length) {
    return res.status(400).json({ 
      error: `Số lượng ảnh (${images.length}) và thời lượng (${durations.length}) không khớp nhau` 
    });
  }
  
  if (!voiceUrl) {
    return res.status(400).json({ error: 'Thiếu trường voiceUrl' });
  }
  
  next();
}

/**
 * Route xử lý task
 */
router.post('/task', validateTaskInput, async (req, res) => {
  try {
    const task = req.body;
    logger.info(`Nhận yêu cầu xử lý task ${task.id}`, 'API');
    
    // Xử lý task bất đồng bộ
    processTask(task)
      .then(result => {
        logger.info(`Task ${task.id} đã hoàn thành thành công`, 'API');
      })
      .catch(error => {
        logger.error(`Task ${task.id} thất bại: ${error.message}`, 'API');
      });
    
    // Trả về ngay lập tức
    res.status(202).json({
      status: 'accepted',
      message: `Task ${task.id} đã được chấp nhận và đang xử lý`,
      taskId: task.id
    });
  } catch (error) {
    logger.error(`Lỗi khi xử lý yêu cầu: ${error.message}`, 'API');
    res.status(500).json({ error: error.message });
  }
});

/**
 * Route kiểm tra trạng thái task
 */
router.get('/task/:id/status', (req, res) => {
  try {
    const taskId = req.params.id;
    const outputPath = path.join(config.paths.output, `output_${taskId}.mp4`);
    
    if (fs.existsSync(outputPath)) {
      res.json({
        status: 'completed',
        taskId: taskId,
        outputPath: outputPath
      });
    } else {
      // Kiểm tra xem có log lỗi không
      const errorLogPath = path.join(config.paths.logs, `task_${taskId}_error.json`);
      
      if (fs.existsSync(errorLogPath)) {
        const errorLog = JSON.parse(fs.readFileSync(errorLogPath, 'utf8'));
        res.json({
          status: 'failed',
          taskId: taskId,
          error: errorLog.error
        });
      } else {
        res.json({
          status: 'processing',
          taskId: taskId
        });
      }
    }
  } catch (error) {
    logger.error(`Lỗi khi kiểm tra trạng thái task: ${error.message}`, 'API');
    res.status(500).json({ error: error.message });
  }
});

/**
 * Route tải video đã xử lý
 */
router.get('/task/:id/download', (req, res) => {
  try {
    const taskId = req.params.id;
    const outputPath = path.join(config.paths.output, `output_${taskId}.mp4`);
    
    if (fs.existsSync(outputPath)) {
      res.download(outputPath);
    } else {
      res.status(404).json({
        error: `Không tìm thấy video cho task ${taskId}`
      });
    }
  } catch (error) {
    logger.error(`Lỗi khi tải video: ${error.message}`, 'API');
    res.status(500).json({ error: error.message });
  }
});

/**
 * Route chạy lệnh FFmpeg trực tiếp
 */
router.post('/ffmpeg', (req, res) => {
  try {
    const { args } = req.body;
    
    if (!args || !Array.isArray(args)) {
      return res.status(400).json({ error: 'Tham số args phải là một mảng' });
    }
    
    logger.info(`Nhận yêu cầu chạy FFmpeg với tham số: ${args.join(' ')}`, 'API');
    
    let stdout = '';
    let stderr = '';
    
    const ffmpeg = spawn('ffmpeg', args);
    
    ffmpeg.stdout.on('data', (data) => {
      const chunk = data.toString();
      stdout += chunk;
    });
    
    ffmpeg.stderr.on('data', (data) => {
      const chunk = data.toString();
      stderr += chunk;
    });
    
    ffmpeg.on('error', (error) => {
      logger.error(`Lỗi khi chạy FFmpeg: ${error.message}`, 'API');
      res.status(500).json({ error: error.message, stderr });
    });
    
    ffmpeg.on('close', (code) => {
      res.json({ code, stdout, stderr });
    });
  } catch (error) {
    logger.error(`Lỗi khi xử lý yêu cầu FFmpeg: ${error.message}`, 'API');
    res.status(500).json({ error: error.message });
  }
});

/**
 * Route chạy lệnh FFprobe trực tiếp
 */
router.post('/ffprobe', (req, res) => {
  try {
    const { args } = req.body;
    
    if (!args || !Array.isArray(args)) {
      return res.status(400).json({ error: 'Tham số args phải là một mảng' });
    }
    
    logger.info(`Nhận yêu cầu chạy FFprobe với tham số: ${args.join(' ')}`, 'API');
    
    let stdout = '';
    let stderr = '';
    
    const ffprobe = spawn('ffprobe', args);
    
    ffprobe.stdout.on('data', (data) => {
      const chunk = data.toString();
      stdout += chunk;
    });
    
    ffprobe.stderr.on('data', (data) => {
      const chunk = data.toString();
      stderr += chunk;
    });
    
    ffprobe.on('error', (error) => {
      logger.error(`Lỗi khi chạy FFprobe: ${error.message}`, 'API');
      res.status(500).json({ error: error.message, stderr });
    });
    
    ffprobe.on('close', (code) => {
      res.json({ code, stdout, stderr });
    });
  } catch (error) {
    logger.error(`Lỗi khi xử lý yêu cầu FFprobe: ${error.message}`, 'API');
    res.status(500).json({ error: error.message });
  }
});

export default router; 