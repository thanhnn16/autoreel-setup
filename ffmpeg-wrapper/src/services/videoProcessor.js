/**
 * Service xử lý video
 */
import fs from 'fs';
import path from 'path-browserify';
import config from '../config/index.js';
import ffmpegConfig from '../config/ffmpeg.js';
import logger from '../utils/logger.js';
import { runFFmpeg } from '../utils/ffmpeg.js';
import { 
  ensureDir, 
  createTempDir,
  removeDir,
  ensureOutputDir,
  cleanupTaskResources } from '../utils/fileManager.js';
import { downloadFile, downloadMultipleFiles } from './fileDownloader.js';
import process from 'process';

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
    const originalCwd = process.cwd(); // Lưu thư mục làm việc ban đầu
    
    // Thiết lập timeout tổng thể cho task
    const taskPromise = this._processTask();
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Task ${this.id} bị timeout sau ${config.timeouts.task / 60000} phút`));
      }, config.timeouts.task);
    });
    
    try {
      // Chạy task với timeout
      return await Promise.race([taskPromise, timeoutPromise]);
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
      // Dọn dẹp tài nguyên tạm thời nếu được cấu hình
      if (config.processing.cleanup) {
        await this.cleanupResources();
      }
      
      // Đảm bảo khôi phục thư mục làm việc ban đầu
      try {
        process.chdir(originalCwd);
        logger.task.info(this.id, `Đã khôi phục thư mục làm việc ban đầu: ${originalCwd}`);
      } catch (cwdError) {
        logger.task.error(this.id, `Không thể khôi phục thư mục làm việc ban đầu: ${cwdError.message}`);
      }
    }
  }
  
  /**
   * Xử lý nội bộ task không có timeout
   * @private
   * @returns {Promise<Object>} - Kết quả xử lý task
   */
  async _processTask() {
    const startTime = Date.now();
    
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
    const imagesDir = path.join(this.tempDir, 'images').replace(/\\/g, '/');
    await ensureDir(imagesDir);
    
    // Tải các ảnh và chỉ lưu tên file
    logger.task.info(this.id, `Bắt đầu tải ${images.length} ảnh`);
    
    // Thiết lập tùy chọn tải file với timeout từ config
    const downloadOptions = {
      taskId: this.id,
      filePrefix: 'image_',
      timeout: config.timeouts.download,
      retries: config.retry.maxAttempts,
      retryDelay: config.retry.delay
    };
    
    const downloadedImages = await downloadMultipleFiles(images, imagesDir, downloadOptions);
    
    // Chỉ lưu đường dẫn tương đối với dấu gạch chéo thuận
    this.resources.images = downloadedImages.map(imagePath => {
      const relativePath = path.relative(this.tempDir, imagePath).replace(/\\/g, '/');
      return relativePath;
    });
    
    // Tải file âm thanh
    logger.task.info(this.id, 'Bắt đầu tải file âm thanh');
    const audioPath = path.join(this.tempDir, 'audio.mp3').replace(/\\/g, '/');
    await downloadFile(voiceUrl, audioPath, downloadOptions);
    this.resources.audio = 'audio.mp3';
    
    // Tải file nền (nếu có)
    if (bgUrl) {
      logger.task.info(this.id, 'Bắt đầu tải file nền');
      const bgPath = path.join(this.tempDir, 'background.mp3').replace(/\\/g, '/');
      await downloadFile(bgUrl, bgPath, downloadOptions);
      this.resources.background = 'background.mp3';
    }
    
    // Lưu URL phụ đề để xử lý sau
    if (subtitleUrl) {
      this.resources.subtitle = subtitleUrl;
      logger.task.info(this.id, 'Đã lưu URL phụ đề để xử lý sau');
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
    // Chuẩn hóa đường dẫn đầu vào
    imageListPath = imageListPath.replace(/\\/g, '/');
    
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
    let invalidImageCount = 0;
    
    for (const line of fileLines) {
      // Trích xuất đường dẫn từ dòng "file 'path'"
      const match = line.match(/file '([^']+)'/);
      if (match && match[1]) {
        const filePath = match[1].replace(/\\/g, '/');
        
        // Kiểm tra xem đường dẫn có bắt đầu bằng '../' không
        if (filePath.startsWith('../')) {
          // Đường dẫn tương đối đến thư mục gốc, cần kiểm tra file thực tế
          const absolutePath = path.resolve(filePath);
          if (!fs.existsSync(absolutePath)) {
            logger.task.warn(this.id, `File ảnh không tồn tại: ${absolutePath}`);
            invalidImageCount++;
            
            // Thử tìm file trong thư mục images
            const fileName = path.basename(filePath);
            const localImagePath = `images/${fileName}`;
            
            if (fs.existsSync(localImagePath)) {
              logger.task.info(this.id, `Tìm thấy file ảnh trong thư mục images: ${localImagePath}`);
              
              // Thay thế đường dẫn trong nội dung
              fixedContent = fixedContent.replace(
                new RegExp(`file '${filePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`, 'g'),
                `file '${localImagePath}'`
              );
              
              hasInvalidPaths = true;
            }
          } else {
            logger.task.info(this.id, `File ảnh tồn tại (đường dẫn tương đối): ${absolutePath}`);
          }
        } else {
          // Kiểm tra file trong thư mục hiện tại với đường dẫn tương đối
          const imagePath = filePath;
          
          // Kiểm tra xem file có tồn tại không
          if (!fs.existsSync(imagePath)) {
            logger.task.warn(this.id, `File ảnh không tồn tại: ${imagePath}`);
            invalidImageCount++;
            
            // Thử tìm trong thư mục images
            const fileName = path.basename(filePath);
            const localImagePath = `images/${fileName}`;
            
            if (fs.existsSync(localImagePath)) {
              logger.task.info(this.id, `Tìm thấy file ảnh trong thư mục images: ${localImagePath}`);
              
              // Thay thế đường dẫn trong nội dung
              fixedContent = fixedContent.replace(
                new RegExp(`file '${filePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`, 'g'),
                `file '${localImagePath}'`
              );
              
              hasInvalidPaths = true;
            } else {
              // Thử tìm với đường dẫn tuyệt đối
              const absolutePath = path.resolve(imagePath);
              if (fs.existsSync(absolutePath)) {
                logger.task.info(this.id, `Tìm thấy file ảnh với đường dẫn tuyệt đối: ${absolutePath}`);
                
                // Thay thế đường dẫn trong nội dung
                fixedContent = fixedContent.replace(
                  new RegExp(`file '${filePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`, 'g'),
                  `file '${absolutePath.replace(/\\/g, '/')}'`
                );
                
                hasInvalidPaths = true;
              }
            }
          } else {
            logger.task.info(this.id, `File ảnh tồn tại: ${imagePath}`);
          }
        }
      }
    }
    
    // Nếu có đường dẫn không hợp lệ, ghi lại file
    if (hasInvalidPaths) {
      logger.task.info(this.id, `Ghi lại file ${imageListPath} với đường dẫn đã sửa`);
      fs.writeFileSync(imageListPath, fixedContent);
      
      // Log nội dung file sau khi sửa
      logger.task.info(this.id, `Nội dung file ${imageListPath} sau khi sửa:\n${fixedContent}`);
    }
    
    // Kiểm tra xem có quá nhiều ảnh không hợp lệ không
    if (invalidImageCount > 0) {
      logger.task.warn(this.id, `Có ${invalidImageCount} ảnh không tồn tại trong danh sách`);
      if (invalidImageCount === fileLines.length) {
        throw new Error('Tất cả các ảnh trong danh sách đều không tồn tại');
      }
    }
  }
  
  /**
   * Tạo video từ các tài nguyên
   */
  async createVideo() {
    logger.task.info(this.id, 'Bắt đầu tạo video');

    // --- Lấy thông số từ config ---
    const {
      frameRate: fps,
      preset,
      crf: video_quality,
      width: video_width,
      height: video_height,
      largeScale,
      bitrate,
      gopSize
    } = ffmpegConfig.video;

    const { kenBurns } = ffmpegConfig.effects;

    // --- Bước 1: Tạo video cho từng ảnh với hiệu ứng Ken Burns ---
    for (let i = 0; i < this.resources.images.length; i++) {
      const imagePath = this.resources.images[i];
      let duration = parseFloat(this.task.durations[i]);

      // Kéo dài thời gian hiển thị của ảnh cuối cùng thêm 2 giây
      if (i === this.resources.images.length - 1) {
        duration = duration + 2;
        logger.task.info(this.id, `Kéo dài thời gian hiển thị của ảnh cuối cùng thêm 2 giây: ${duration}s`);
      }

      const index = i + 1;
      const frames = Math.round(fps * duration);

      // Tạo hiệu ứng Ken Burns hiện đại hơn cho mỗi ảnh
      let zoompan_filter;
      switch (index % 4) {
        case 0: {
          // Zoom vào trung tâm
          const { scale, x, y } = kenBurns.zoomIn;
          zoompan_filter = `scale=${largeScale}:-1,zoompan=z='${scale.replace('{frames}', frames)}':x='${x}':y='${y}':d=${frames}:s=${video_width}x${video_height}:fps=${fps}`;
          break;
        }
        case 1: {
          // Pan từ trái sang phải
          const { scale, x, y } = kenBurns.panRight;
          zoompan_filter = `scale=${largeScale}:-1,zoompan=z='${scale}':x='${x.replace('{frames}', frames)}':y='${y}':d=${frames}:s=${video_width}x${video_height}:fps=${fps}`;
          break;
        }
        case 2: {
          // Pan từ trên xuống
          const { scale, x, y } = kenBurns.panDown;
          zoompan_filter = `scale=${largeScale}:-1,zoompan=z='${scale}':x='${x}':y='${y.replace('{frames}', frames)}':d=${frames}:s=${video_width}x${video_height}:fps=${fps}`;
          break;
        }
        case 3: {
          // Zoom out
          const { scale, x, y } = kenBurns.zoomOut;
          zoompan_filter = `scale=${largeScale}:-1,zoompan=z='${scale.replace('{frames}', frames)}':x='${x}':y='${y}':d=${frames}:s=${video_width}x${video_height}:fps=${fps}`;
          break;
        }
      }

      const filter_complex = [
        zoompan_filter,
        'setsar=1',
        'format=yuv420p'
      ].join(',');

      const args = [
        "-y", "-threads", "0",
        "-loop", "1", "-i", path.join(this.tempDir, imagePath),
        "-t", duration.toString(),
        "-vf", filter_complex,
        "-c:v", ffmpegConfig.video.codec,
        "-pix_fmt", ffmpegConfig.video.pixFmt,
        "-preset", preset,
        "-crf", video_quality.toString(),
        "-r", fps.toString(),
        "-g", gopSize.toString(),
        "-keyint_min", gopSize.toString(),
        "-sc_threshold", "0",
        "-b:v", bitrate,
        "-movflags", "+faststart",
        path.join(this.tempDir, `${index}.mp4`)
      ];

      await runFFmpeg(args);
      logger.task.info(this.id, `Đã xử lý xong ảnh ${index}`);
    }

    // --- Bước 2: Nối video và thêm hiệu ứng chuyển cảnh ---
    const temp_video_no_audio = path.join(this.tempDir, 'temp_video_no_audio.mp4');
    
    // Sử dụng xfade để có hiệu ứng chuyển cảnh đẹp hơn
    const videoList = this.resources.images.map((_, i) => path.join(this.tempDir, `${i + 1}.mp4`));
    
    // Tạo filter complex để ghép video với hiệu ứng chuyển cảnh
    let filterComplex = '';
    const concatArgs = ["-y", "-threads", "0"];
    
    for (const videoPath of videoList) {
      concatArgs.push("-i", videoPath);
    }
    
    // Tạo filter complex với hiệu ứng xfade
    for (let i = 0; i < videoList.length; i++) {
      filterComplex += `[${i}:v]`;
    }
    filterComplex += `concat=n=${videoList.length}:v=1:a=0[outv]`;
    
    concatArgs.push(
      "-filter_complex", filterComplex,
      "-map", "[outv]",
      "-c:v", ffmpegConfig.video.codec,
      "-pix_fmt", ffmpegConfig.video.pixFmt,
      "-preset", preset,
      "-crf", video_quality.toString(),
      "-r", fps.toString(),
      temp_video_no_audio
    );
    
    await runFFmpeg(concatArgs);

    // --- Bước 3: Mix âm thanh ---
    const temp_audio = path.join(this.tempDir, 'temp_audio.mp3');
    
    if (this.resources.background) {
      // Mix âm thanh nếu có nhạc nền
      const {
        voiceVolume,
        bgVolume,
        bgFadeInDuration,
        sidechain,
        dynaudnorm
      } = ffmpegConfig.audio.mixing;

      const audioArgs = [
        "-y", "-threads", "0",
        "-i", path.join(this.tempDir, this.resources.audio),
        "-i", path.join(this.tempDir, this.resources.background),
        "-filter_complex",
        `[0:a]volume=${voiceVolume}[voice];
         [1:a]volume=${bgVolume},afade=t=in:st=0:d=${bgFadeInDuration}[bgfaded];
         [bgfaded][0:a]sidechaincompress=threshold=${sidechain.threshold}:ratio=${sidechain.ratio}:attack=${sidechain.attack}:release=${sidechain.release}[duckedbg];
         [voice][duckedbg]amix=inputs=2:duration=first:dropout_transition=2,dynaudnorm=f=${dynaudnorm.framelen}[out]`,
        "-map", "[out]",
        temp_audio
      ];

      await runFFmpeg(audioArgs);
      logger.task.info(this.id, 'Đã mix âm thanh voice và nhạc nền thành công');
    } else {
      // Nếu không có nhạc nền, chỉ xử lý voice
      const { framelen } = ffmpegConfig.audio.mixing.dynaudnorm;
      const audioArgs = [
        "-y", "-threads", "0",
        "-i", path.join(this.tempDir, this.resources.audio),
        "-filter_complex",
        `[0:a]dynaudnorm=f=${framelen}[out]`,
        "-map", "[out]",
        temp_audio
      ];

      await runFFmpeg(audioArgs);
      logger.task.info(this.id, 'Đã xử lý âm thanh voice (không có nhạc nền)');
    }

    // --- Bước 4: Kết hợp video và âm thanh ---
    this.outputPath = path.join('output', `output_${this.id}.mp4`);
    await ensureOutputDir(path.dirname(this.outputPath));

    const finalArgs = [
      "-y", "-threads", "0",
      "-i", temp_video_no_audio,
      "-i", temp_audio,
      "-map", "0:v",
      "-map", "1:a",
      "-c:v", ffmpegConfig.video.codec,
      "-c:a", ffmpegConfig.audio.codec,
      this.outputPath
    ];

    await runFFmpeg(finalArgs);
    logger.task.info(this.id, 'Đã kết hợp video và âm thanh thành công');

    // Xóa các file tạm
    const tempFiles = [
      temp_video_no_audio,
      temp_audio,
      ...videoList
    ];

    for (const file of tempFiles) {
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
      }
    }
  }

  /**
   * Dọn dẹp tài nguyên tạm thời
   */
  async cleanupResources() {
    try {
      if (!this.tempDir) {
        logger.task.warn(this.id, 'Không có thư mục tạm để dọn dẹp');
        return;
      }

      logger.task.info(this.id, 'Bắt đầu dọn dẹp tài nguyên tạm thời');

      // Đảm bảo chúng ta đang ở thư mục gốc, không phải thư mục tạm
      const originalCwd = process.cwd();
      if (originalCwd.includes(this.tempDir)) {
        process.chdir(path.resolve(config.paths.root));
        logger.task.info(this.id, `Đã chuyển về thư mục gốc từ ${originalCwd}`);
      }

      // Kiểm tra file đầu ra trước khi xóa thư mục tạm
      if (this.outputPath) {
        // Chuyển đổi đường dẫn tương đối thành tuyệt đối để kiểm tra
        const absoluteOutputPath = path.resolve(this.outputPath);
        
        // Đảm bảo thư mục output tồn tại và có quyền ghi
        const outputDir = path.dirname(absoluteOutputPath);
        if (outputDir) {
          const outputDirValid = await ensureOutputDir(outputDir);
          
          // Kiểm tra xem file đầu ra có tồn tại không
          if (!fs.existsSync(absoluteOutputPath)) {
            logger.task.error(this.id, `File đầu ra không tồn tại: ${this.outputPath}`);
            
            // Thử sao chép file từ thư mục tạm nếu có
            const tempOutputFile = path.join(this.tempDir, 'output.mp4');
            if (fs.existsSync(tempOutputFile)) {
              try {
                // Đảm bảo thư mục đích tồn tại
                await ensureDir(outputDir);
                fs.copyFileSync(tempOutputFile, absoluteOutputPath);
                logger.task.info(this.id, `Đã sao chép file từ thư mục tạm: ${tempOutputFile} -> ${absoluteOutputPath}`);
              } catch (copyError) {
                logger.task.error(this.id, `Không thể sao chép file từ thư mục tạm: ${copyError.message}`);
              }
            }
          } else {
            const stats = fs.statSync(absoluteOutputPath);
            if (stats.size === 0) {
              logger.task.error(this.id, `File đầu ra có kích thước 0 byte: ${this.outputPath}`);
              
              // Thử sao chép file từ thư mục tạm nếu có
              const tempOutputFile = path.join(this.tempDir, 'output.mp4');
              if (fs.existsSync(tempOutputFile)) {
                const tempStats = fs.statSync(tempOutputFile);
                if (tempStats.size > 0) {
                  try {
                    fs.copyFileSync(tempOutputFile, absoluteOutputPath);
                    logger.task.info(this.id, `Đã sao chép file từ thư mục tạm: ${tempOutputFile} -> ${absoluteOutputPath}`);
                  } catch (copyError) {
                    logger.task.error(this.id, `Không thể sao chép file từ thư mục tạm: ${copyError.message}`);
                  }
                }
              }
            } else {
              logger.task.info(this.id, `File đầu ra tồn tại và hợp lệ: ${this.outputPath} (${stats.size} bytes)`);
            }
          }
        } else {
          logger.task.warn(this.id, `Không thể xác định thư mục đầu ra từ đường dẫn: ${this.outputPath}`);
        }
      }

      // Sử dụng hàm cleanupTaskResources từ fileManager để dọn dẹp tài nguyên tạm
      try {
        if (typeof cleanupTaskResources === 'function') {
          await cleanupTaskResources(this.id);
          logger.task.info(this.id, `Đã dọn dẹp tài nguyên tạm bằng cleanupTaskResources: ${this.id}`);
          return;
        }
      } catch (cleanupError) {
        logger.task.warn(this.id, `Lỗi khi sử dụng cleanupTaskResources: ${cleanupError.message}`);
      }

      // Nếu không thể sử dụng cleanupTaskResources, thực hiện dọn dẹp thủ công
      // Xóa các file tạm
      const filesToDelete = [
        // File âm thanh
        path.join(this.tempDir, 'audio.mp3'),
        path.join(this.tempDir, 'background.mp3'),
        path.join(this.tempDir, 'temp_audio.mp3'),
        
        // File video tạm
        path.join(this.tempDir, 'temp_video_no_audio.mp4'),
        path.join(this.tempDir, 'images.txt')
      ];

      // Xóa các file video tạm theo index
      for (let i = 1; i <= this.resources.images.length; i++) {
        filesToDelete.push(path.join(this.tempDir, `${i}.mp4`));
        filesToDelete.push(path.join(this.tempDir, `xfade_temp_${i-1}.mp4`));
      }

      // Xóa các file
      for (const file of filesToDelete) {
        if (fs.existsSync(file)) {
          try {
            fs.unlinkSync(file);
            logger.task.info(this.id, `Đã xóa file: ${file}`);
          } catch (unlinkError) {
            logger.task.warn(this.id, `Không thể xóa file: ${file} - ${unlinkError.message}`);
          }
        }
      }

      // Xóa thư mục images và các file ảnh trong đó
      const imagesDir = path.join(this.tempDir, 'images');
      if (fs.existsSync(imagesDir)) {
        try {
          const imageFiles = fs.readdirSync(imagesDir);
          for (const file of imageFiles) {
            try {
              fs.unlinkSync(path.join(imagesDir, file));
            } catch (unlinkError) {
              logger.task.warn(this.id, `Không thể xóa file ảnh: ${file} - ${unlinkError.message}`);
            }
          }
          fs.rmdirSync(imagesDir);
          logger.task.info(this.id, `Đã xóa thư mục images và ${imageFiles.length} file ảnh`);
        } catch (imagesError) {
          logger.task.warn(this.id, `Lỗi khi xóa thư mục images: ${imagesError.message}`);
        }
      }

      // QUAN TRỌNG: KHÔNG xóa thư mục temp gốc, chỉ xóa thư mục tạm của task hiện tại
      // Kiểm tra xem thư mục tạm có phải là thư mục con của thư mục temp không
      if (config.paths.temp) {
        const tempBasePath = path.resolve(config.paths.temp);
        const currentTempPath = path.resolve(this.tempDir);
        
        if (currentTempPath !== tempBasePath && currentTempPath.startsWith(tempBasePath)) {
          // Chỉ xóa thư mục tạm của task hiện tại, không xóa thư mục temp gốc
          if (fs.existsSync(this.tempDir)) {
            // Kiểm tra xem thư mục có trống không trước khi xóa
            const remainingFiles = fs.readdirSync(this.tempDir);
            if (remainingFiles.length > 0) {
              logger.task.warn(this.id, `Thư mục tạm vẫn còn ${remainingFiles.length} file, đang xóa từng file...`);
              for (const file of remainingFiles) {
                const filePath = path.join(this.tempDir, file);
                try {
                  const fileStat = fs.statSync(filePath);
                  if (fileStat.isDirectory()) {
                    // Sử dụng hàm removeDir từ fileManager để xóa thư mục con
                    if (typeof removeDir === 'function') {
                      await removeDir(filePath);
                    } else {
                      logger.task.warn(this.id, `Hàm removeDir không khả dụng, thử xóa thủ công`);
                      fs.rmdirSync(filePath, { recursive: true, force: true });
                    }
                  } else {
                    fs.unlinkSync(filePath);
                  }
                  logger.task.info(this.id, `Đã xóa: ${filePath}`);
                } catch (err) {
                  logger.task.warn(this.id, `Không thể xóa ${filePath}: ${err.message}`);
                }
              }
            }
            
            try {
              fs.rmdirSync(this.tempDir);
              logger.task.info(this.id, `Đã xóa thư mục tạm của task: ${this.tempDir}`);
            } catch (rmError) {
              logger.task.error(this.id, `Không thể xóa thư mục tạm ${this.tempDir}: ${rmError.message}`);
              // Thử dùng hàm removeDir từ fileManager
              try {
                if (typeof removeDir === 'function') {
                  await removeDir(this.tempDir);
                  logger.task.info(this.id, `Đã xóa thư mục tạm bằng removeDir: ${this.tempDir}`);
                } else {
                  logger.task.warn(this.id, `Hàm removeDir không khả dụng, không thể xóa thư mục tạm`);
                }
              } catch (utilError) {
                logger.task.error(this.id, `Vẫn không thể xóa thư mục tạm: ${utilError.message}`);
              }
            }
          }
        } else {
          logger.task.warn(this.id, `Không xóa thư mục ${this.tempDir} vì đây có thể là thư mục gốc`);
        }
      } else {
        logger.task.warn(this.id, 'Không thể xác định thư mục temp gốc từ config');
      }
    } catch (error) {
      logger.task.warn(this.id, `Lỗi khi dọn dẹp tài nguyên tạm: ${error.message}`);
    }
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