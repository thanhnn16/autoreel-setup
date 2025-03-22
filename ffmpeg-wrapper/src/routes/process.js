/**
 * Routes xử lý video
 */
import express from 'express';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { processTask } from '../services/videoProcessor.js';
import { processSeparateTask } from '../services/separateVideoProcessor.js';
import logger from '../utils/logger.js';
import config from '../config/index.js';

const router = express.Router();

// Lưu trữ danh sách các task đang xử lý
const processingTasks = new Set();

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
 * Middleware kiểm tra dữ liệu đầu vào cho xử lý video riêng biệt
 */
function validateSeparateTaskInput(req, res, next) {
  const { id, images, durations, subtitles, voices } = req.body;
  
  if (!id) {
    return res.status(400).json({ error: 'Thiếu trường id' });
  }
  
  if (!images || !Array.isArray(images) || images.length === 0) {
    return res.status(400).json({ error: 'Trường images phải là một mảng không rỗng' });
  }
  
  if (!durations || !Array.isArray(durations) || durations.length === 0) {
    return res.status(400).json({ error: 'Trường durations phải là một mảng không rỗng' });
  }
  
  if (!voices || !Array.isArray(voices) || voices.length === 0) {
    return res.status(400).json({ error: 'Trường voices phải là một mảng không rỗng' });
  }

  if (!subtitles || !Array.isArray(subtitles)) {
    return res.status(400).json({ error: 'Trường subtitles phải là một mảng' });
  }
  
  // Kiểm tra số lượng phần tử trong các mảng phải bằng nhau
  const length = images.length;
  if (durations.length !== length || voices.length !== length || subtitles.length !== length) {
    return res.status(400).json({ 
      error: `Số lượng phần tử trong các mảng không khớp nhau: images(${images.length}), durations(${durations.length}), voices(${voices.length}), subtitles(${subtitles.length})` 
    });
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
    
    // Thêm task vào danh sách đang xử lý
    processingTasks.add(task.id);
    
    // Xử lý task bất đồng bộ
    processTask(task)
      .then(() => {
        logger.info(`Task ${task.id} đã hoàn thành thành công`, 'API');
        // Xóa task khỏi danh sách đang xử lý
        processingTasks.delete(task.id);
      })
      .catch(error => {
        logger.error(`Task ${task.id} thất bại: ${error.message}`, 'API');
        // Xóa task khỏi danh sách đang xử lý
        processingTasks.delete(task.id);
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
 * Route xử lý video riêng biệt
 */
router.post('/separate', validateSeparateTaskInput, async (req, res) => {
  try {
    const task = req.body;
    logger.info(`Nhận yêu cầu xử lý task riêng biệt ${task.id}`, 'API');
    
    // Thêm task vào danh sách đang xử lý
    processingTasks.add(task.id);
    
    // Xử lý task bất đồng bộ
    processSeparateTask(task)
      .then(() => {
        logger.info(`Task riêng biệt ${task.id} đã hoàn thành thành công`, 'API');
        // Xóa task khỏi danh sách đang xử lý
        processingTasks.delete(task.id);
      })
      .catch(error => {
        logger.error(`Task riêng biệt ${task.id} thất bại: ${error.message}`, 'API');
        // Xóa task khỏi danh sách đang xử lý
        processingTasks.delete(task.id);
      });
    
    // Trả về ngay lập tức
    res.status(202).json({
      status: 'accepted',
      message: `Task riêng biệt ${task.id} đã được chấp nhận và đang xử lý`,
      taskId: task.id
    });
  } catch (error) {
    logger.error(`Lỗi khi xử lý yêu cầu riêng biệt: ${error.message}`, 'API');
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
        // Kiểm tra xem task có đang được xử lý không
        const isProcessing = processingTasks.has(taskId);
        res.json({
          status: isProcessing ? 'processing' : 'unknown',
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
    
    if (!fs.existsSync(outputPath)) {
      return res.status(404).json({
        error: `Không tìm thấy video cho task ${taskId}`
      });
    }

    const fileName = `video_${taskId}.mp4`;
    
    // Thiết lập header cho việc tải xuống
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    
    // Sử dụng createReadStream để truyền file trực tiếp
    const fileStream = fs.createReadStream(outputPath);
    
    // Xử lý lỗi stream
    fileStream.on('error', (error) => {
      logger.error(`Lỗi khi tải video: ${error.message}`, 'API');
      if (!res.headersSent) {
        res.status(500).json({ error: error.message });
      }
    });
    
    // Pipe stream trực tiếp đến response
    fileStream.pipe(res);
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

/**
 * Route kiểm tra danh sách các task đang xử lý
 */
router.get('/processing', (req, res) => {
  try {
    const taskList = Array.from(processingTasks);
    res.json({
      status: 'success',
      count: taskList.length,
      tasks: taskList
    });
  } catch (error) {
    logger.error(`Lỗi khi lấy danh sách task: ${error.message}`, 'API');
    res.status(500).json({ error: error.message });
  }
});

/**
 * Route tải video từ thư mục output
 */
router.get('/output/:filename', (req, res) => {
  try {
    const filename = req.params.filename;
    const outputPath = path.join(config.paths.output, filename);
    
    if (!fs.existsSync(outputPath)) {
      return res.status(404).json({
        error: `Không tìm thấy file: ${filename}`
      });
    }
    
    // Kiểm tra xem đó có phải là file video không
    const ext = path.extname(filename).toLowerCase();
    const validVideoExts = ['.mp4', '.webm', '.mov', '.avi', '.mkv'];
    
    if (!validVideoExts.includes(ext)) {
      return res.status(400).json({
        error: `File không phải là video: ${filename}`
      });
    }
    
    logger.info(`Gửi file video: ${filename}`, 'API');
    res.download(outputPath);
  } catch (error) {
    logger.error(`Lỗi khi tải file: ${error.message}`, 'API');
    res.status(500).json({ error: error.message });
  }
});

export default router; 