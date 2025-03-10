/**
 * Service xử lý video
 */
import fs from 'fs';
import path from 'path-browserify';
import { paths } from '../utils/alias.js';
import config from '../config/index.js';
import ffmpegConfig from '../config/ffmpeg.js';
import logger from '../utils/logger.js';
import { runFFmpeg, runFFprobe } from '../utils/ffmpeg.js';
import { 
  ensureDir, 
  createTempDir, 
  cleanupTaskResources,
  generateUniqueFilename 
} from '../utils/fileManager.js';
import { downloadFile, downloadMultipleFiles } from './fileDownloader.js';
import { processAssSubtitle } from './subtitleProcessor.js';

/**
 * Lớp xử lý task video
 */
class TaskProcessor {
  /**
   * Khởi tạo processor cho task
   * @param {Object} task - Thông tin task
   */
  constructor(task) {
    this.task = task;
    this.id = task.id;
    this.tempDir = null;
    this.outputPath = null;
    this.resources = {
      images: [],
      audio: null,
      background: null,
      subtitle: null
    };
    
    this.logPrefix = `[Task ${this.id}]`;
  }
  
  /**
   * Xử lý toàn bộ task
   * @returns {Promise<Object>} - Kết quả xử lý task
   */
  async process() {
    const startTime = Date.now();
    
    try {
      logger.task.info(this.id, 'Bắt đầu xử lý task');
      logger.task.logData(this.id, this.task, 'input');
      
      // Kiểm tra dữ liệu đầu vào
      this.validateInput();
      
      // Tạo thư mục tạm thời
      this.tempDir = await createTempDir(this.id);
      
      // Tải và chuẩn bị tài nguyên
      await this.prepareResources();
      
      // Tạo video
      await this.createVideo();
      
      // Ghi log kết quả
      const duration = (Date.now() - startTime) / 1000;
      const result = {
        id: this.id,
        status: 'success',
        outputPath: this.outputPath,
        duration: duration,
        timestamp: new Date().toISOString()
      };
      
      logger.task.logData(this.id, result, 'output');
      logger.task.info(this.id, `Hoàn thành xử lý task sau ${duration}s`);
      
      return result;
    } catch (error) {
      const duration = (Date.now() - startTime) / 1000;
      const errorResult = {
        id: this.id,
        status: 'error',
        error: error.message,
        duration: duration,
        timestamp: new Date().toISOString()
      };
      
      logger.task.error(this.id, `Lỗi khi xử lý task: ${error.message}`);
      logger.task.logData(this.id, errorResult, 'error');
      
      throw error;
    } finally {
      // Dọn dẹp tài nguyên tạm thời nếu cần
      if (config.cleanup) {
        await cleanupTaskResources(this.id);
      }
    }
  }
  
  /**
   * Kiểm tra dữ liệu đầu vào
   */
  validateInput() {
    const { images, durations, voiceUrl } = this.task;
    
    // Kiểm tra images có tồn tại không
    if (!images) {
      throw new Error('Trường images không tồn tại hoặc là null');
    }
    
    // Kiểm tra durations có tồn tại không
    if (!durations) {
      throw new Error('Trường durations không tồn tại hoặc là null');
    }
    
    // Kiểm tra voiceUrl có tồn tại không
    if (!voiceUrl) {
      throw new Error('Trường voiceUrl không tồn tại hoặc là null');
    }
    
    // Kiểm tra số lượng ảnh và thời lượng có khớp nhau không
    if (images.length !== durations.length) {
      throw new Error(`Số lượng ảnh (${images.length}) và thời lượng (${durations.length}) không khớp nhau`);
    }
    
    logger.task.info(this.id, `Dữ liệu đầu vào hợp lệ với ${images.length} ảnh`);
  }
  
  /**
   * Tải và chuẩn bị tài nguyên
   */
  async prepareResources() {
    const { images, voiceUrl, bgUrl, subtitleUrl } = this.task;
    
    // Tạo thư mục cho ảnh
    const imagesDir = path.join(this.tempDir, 'images');
    await ensureDir(imagesDir);
    
    // Tải các ảnh
    logger.task.info(this.id, `Bắt đầu tải ${images.length} ảnh`);
    this.resources.images = await downloadMultipleFiles(images, imagesDir, {
      taskId: this.id,
      filePrefix: 'image_'
    });
    
    // Tải file âm thanh
    logger.task.info(this.id, 'Bắt đầu tải file âm thanh');
    const audioPath = path.join(this.tempDir, 'audio.mp3');
    this.resources.audio = await downloadFile(voiceUrl, audioPath, { taskId: this.id });
    
    // Tải file nền (nếu có)
    if (bgUrl) {
      logger.task.info(this.id, 'Bắt đầu tải file nền');
      const bgPath = path.join(this.tempDir, 'background.mp3');
      this.resources.background = await downloadFile(bgUrl, bgPath, { taskId: this.id });
    }
    
    // Xử lý phụ đề (nếu có)
    if (subtitleUrl) {
      logger.task.info(this.id, 'Bắt đầu xử lý phụ đề');
      this.resources.subtitle = await processAssSubtitle(subtitleUrl, this.tempDir, { 
        taskId: this.id,
        duration: this.calculateTotalDuration()
      });
    }
    
    logger.task.info(this.id, 'Đã chuẩn bị xong tất cả tài nguyên');
  }
  
  /**
   * Tính tổng thời lượng của video
   * @returns {number} - Tổng thời lượng (giây)
   */
  calculateTotalDuration() {
    return this.task.durations.reduce((sum, duration) => sum + duration, 0);
  }
  
  /**
   * Kiểm tra và sửa đường dẫn trong file images.txt
   * @param {string} imageListPath - Đường dẫn đến file images.txt
   * @returns {Promise<void>}
   */
  async validateImageListPaths(imageListPath) {
    if (!fs.existsSync(imageListPath)) {
      throw new Error(`File danh sách ảnh không tồn tại: ${imageListPath}`);
    }
    
    logger.task.info(this.id, `Kiểm tra đường dẫn trong file ${imageListPath}`);
    
    // Đọc nội dung file
    const content = fs.readFileSync(imageListPath, 'utf8');
    const lines = content.split('\n');
    
    // Lọc các dòng chứa đường dẫn file (bắt đầu bằng "file '")
    const fileLines = lines.filter(line => line.trim().startsWith("file '"));
    
    // Kiểm tra từng đường dẫn
    let hasInvalidPaths = false;
    let fixedContent = content;
    
    for (const line of fileLines) {
      // Trích xuất đường dẫn từ dòng "file 'path'"
      const match = line.match(/file '([^']+)'/);
      if (match && match[1]) {
        const filePath = match[1];
        
        // Tạo đường dẫn tuyệt đối từ đường dẫn tương đối trong file
        const absolutePath = path.resolve(path.dirname(imageListPath), filePath);
        
        // Kiểm tra xem file có tồn tại không
        if (!fs.existsSync(absolutePath)) {
          logger.task.warn(this.id, `File ảnh không tồn tại: ${absolutePath}`);
          
          // Thử tìm file với đường dẫn khác
          // Kiểm tra xem file có nằm trong thư mục images không
          const imagesDir = path.join(this.tempDir, 'images');
          const fileName = path.basename(filePath);
          const alternativePath = path.join(imagesDir, fileName);
          
          if (fs.existsSync(alternativePath)) {
            // Tạo đường dẫn tương đối mới, đơn giản hơn
            const newRelativePath = `images/${fileName}`;
            logger.task.info(this.id, `Tìm thấy file thay thế: ${alternativePath}`);
            logger.task.info(this.id, `Sửa đường dẫn trong images.txt: ${filePath} -> ${newRelativePath}`);
            
            // Thay thế đường dẫn trong nội dung
            fixedContent = fixedContent.replace(
              new RegExp(`file '${filePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`, 'g'),
              `file '${newRelativePath}'`
            );
            
            hasInvalidPaths = true;
          }
        } else {
          logger.task.info(this.id, `File ảnh tồn tại: ${absolutePath}`);
        }
      }
    }
    
    // Nếu có đường dẫn không hợp lệ, ghi lại file
    if (hasInvalidPaths) {
      logger.task.info(this.id, `Ghi lại file ${imageListPath} với đường dẫn đã sửa`);
      fs.writeFileSync(imageListPath, fixedContent);
      
      // Log nội dung file sau khi sửa
      logger.task.info(this.id, `Nội dung file images.txt sau khi sửa:\n${fixedContent}`);
    }
  }
  
  /**
   * Tạo video từ các tài nguyên
   */
  async createVideo() {
    logger.task.info(this.id, 'Bắt đầu tạo video');
    
    // Tạo file danh sách ảnh và thời lượng
    const imageListPath = path.join(this.tempDir, 'images.txt');
    let imageListContent = '';
    
    this.resources.images.forEach((imagePath, index) => {
      const duration = this.task.durations[index];
      
      // Sửa: Sử dụng đường dẫn tương đối đơn giản hơn
      // Chỉ sử dụng tên file thay vì đường dẫn tương đối đầy đủ
      // Vì file images.txt và thư mục images nằm cùng cấp trong thư mục task
      const fileName = path.basename(imagePath);
      const simplePath = `images/${fileName}`;
      
      imageListContent += `file '${simplePath}'\n`;
      imageListContent += `duration ${duration}\n`;
    });
    
    // Thêm ảnh cuối cùng một lần nữa (yêu cầu của FFmpeg)
    if (this.resources.images.length > 0) {
      const lastImage = this.resources.images[this.resources.images.length - 1];
      const fileName = path.basename(lastImage);
      const simplePath = `images/${fileName}`;
      imageListContent += `file '${simplePath}'\n`;
    }
    
    // Ghi file danh sách ảnh
    fs.writeFileSync(imageListPath, imageListContent);
    
    // Log nội dung file để kiểm tra
    logger.task.info(this.id, `Nội dung file images.txt:\n${imageListContent}`);
    
    // Kiểm tra và sửa đường dẫn trong file images.txt
    await this.validateImageListPaths(imageListPath);
    
    // Tạo tên file đầu ra
    const outputFilename = `output_${this.id}.mp4`;
    this.outputPath = path.join(config.paths.output, outputFilename);
    
    // Đảm bảo thư mục đầu ra tồn tại
    await ensureDir(config.paths.output);
    
    // Kiểm tra xem thư mục output có tồn tại không
    if (!fs.existsSync(config.paths.output)) {
      logger.task.info(this.id, `Thư mục output không tồn tại, tạo mới: ${config.paths.output}`);
      fs.mkdirSync(config.paths.output, { recursive: true });
    }
    
    // Xây dựng lệnh FFmpeg
    const ffmpegArgs = [
      '-y', // Ghi đè file đầu ra nếu tồn tại
      '-f', 'concat', // Sử dụng định dạng concat
      '-safe', '0', // Cho phép đường dẫn tuyệt đối
      '-i', imageListPath, // File danh sách ảnh
      '-i', this.resources.audio, // File âm thanh
    ];
    
    // Thêm file nền nếu có
    if (this.resources.background) {
      ffmpegArgs.push('-i', this.resources.background);
    }
    
    // Thêm các tham số video
    ffmpegArgs.push(
      '-c:v', ffmpegConfig.video.codec,
      '-pix_fmt', ffmpegConfig.video.pixFmt,
      '-r', ffmpegConfig.video.frameRate.toString(),
      '-preset', ffmpegConfig.video.preset,
      '-crf', ffmpegConfig.video.crf.toString()
    );
    
    // Xử lý âm thanh
    if (this.resources.background) {
      // Trộn âm thanh chính và âm thanh nền
      ffmpegArgs.push(
        '-filter_complex', '[1:a][2:a]amix=inputs=2:duration=longest:dropout_transition=2[aout]',
        '-map', '0:v',
        '-map', '[aout]'
      );
    }
    
    // Thêm phụ đề nếu có
    if (this.resources.subtitle) {
      // Đảm bảo đường dẫn phụ đề là đường dẫn tuyệt đối
      const subtitlePath = path.resolve(this.resources.subtitle);
      logger.task.info(this.id, `Sử dụng file phụ đề: ${subtitlePath}`);
      
      // Kiểm tra xem file phụ đề có tồn tại không
      if (!fs.existsSync(subtitlePath)) {
        logger.task.warn(this.id, `File phụ đề không tồn tại: ${subtitlePath}`);
      }
      
      // Escape đường dẫn cho FFmpeg - sửa cách escape cho Windows
      // Cần escape dấu : và \ đúng cách, và bọc đường dẫn trong dấu nháy đơn
      const escapedPath = subtitlePath.replace(/\\/g, '\\\\').replace(/:/g, '\\:');
      
      // Thêm filter phụ đề
      const subtitleFilter = `subtitles='${escapedPath}'`;
      
      // Nếu đã có filter trước đó, thêm vào chuỗi filter
      const filterIndex = ffmpegArgs.indexOf('-vf');
      if (filterIndex !== -1) {
        ffmpegArgs[filterIndex + 1] = `${ffmpegArgs[filterIndex + 1]},${subtitleFilter}`;
      } else {
        ffmpegArgs.push('-vf', subtitleFilter);
      }
    }
    
    // Thêm tiêu đề nếu có
    if (this.task.titleText) {
      const titleFilter = `drawtext=text='${this.task.titleText}':fontcolor=white:fontsize=24:x=(w-text_w)/2:y=h-th-10`;
      
      // Nếu đã có filter trước đó, thêm vào chuỗi filter
      const filterIndex = ffmpegArgs.indexOf('-vf');
      if (filterIndex !== -1) {
        ffmpegArgs[filterIndex + 1] = `${ffmpegArgs[filterIndex + 1]},${titleFilter}`;
      } else {
        ffmpegArgs.push('-vf', titleFilter);
      }
    }
    
    // Thêm tham số đầu ra
    ffmpegArgs.push(
      '-c:a', ffmpegConfig.audio.codec,
      '-b:a', ffmpegConfig.audio.bitrate,
      '-shortest',
      this.outputPath
    );
    
    // Chạy FFmpeg
    logger.task.info(this.id, `Bắt đầu tạo video với lệnh: ffmpeg ${ffmpegArgs.join(' ')}`);
    await runFFmpeg(ffmpegArgs, { taskId: this.id });
    
    logger.task.info(this.id, `Đã tạo video thành công: ${this.outputPath}`);
    return this.outputPath;
  }
}

/**
 * Xử lý task video
 * @param {Object} task - Thông tin task
 * @returns {Promise<Object>} - Kết quả xử lý task
 */
async function processTask(task) {
  const processor = new TaskProcessor(task);
  return await processor.process();
}

export {
  processTask,
  TaskProcessor
}; 