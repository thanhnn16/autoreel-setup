/**
 * Service xử lý video riêng biệt
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
import { downloadFile } from './fileDownloader.js';
import process from 'process';
import { processAssSubtitle } from './subtitleProcessor.js';

/**
 * Lớp xử lý video riêng biệt
 */
class SeparateVideoProcessor {
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
      voices: [],
      subtitles: [],
      separateVideos: []
    };
    
    this.logPrefix = `[Task ${this.id}]`;
  }

  /**
   * Xử lý toàn bộ task
   */
  async process() {
    const startTime = Date.now();
    const originalCwd = process.cwd();

    const taskPromise = this._processTask();
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Task ${this.id} bị timeout sau ${config.timeouts.task / 60000} phút`));
      }, config.timeouts.task);
    });

    try {
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
      if (config.processing.cleanup) {
        await this.cleanupResources();
      }
      
      try {
        process.chdir(originalCwd);
        logger.task.info(this.id, `Đã khôi phục thư mục làm việc ban đầu: ${originalCwd}`);
      } catch (cwdError) {
        logger.task.error(this.id, `Không thể khôi phục thư mục làm việc ban đầu: ${cwdError.message}`);
      }
    }
  }

  /**
   * Xử lý nội bộ task
   */
  async _processTask() {
    const startTime = Date.now();
    
    logger.task.info(this.id, 'Bắt đầu xử lý task riêng biệt');
    logger.task.logData(this.id, this.task, 'input');
    
    // Tạo thư mục tạm thời
    this.tempDir = await createTempDir(this.id);
    
    // Tải và chuẩn bị tài nguyên
    await this.prepareResources();
    
    // Xử lý từng phần video riêng biệt
    await this.processSeparateVideos();
    
    // Nối các video lại với nhau
    await this.combineVideos();
    
    // Thêm tiêu đề nếu có
    if (this.task.titleText) {
      await this.addTitle();
    }
    
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
   * Tải và chuẩn bị tài nguyên
   */
  async prepareResources() {
    const { images, voices, subtitles } = this.task;
    
    // Tạo thư mục cho ảnh và video riêng biệt
    const imagesDir = path.join(this.tempDir, 'images').replace(/\\/g, '/');
    const voicesDir = path.join(this.tempDir, 'voices').replace(/\\/g, '/');
    const subtitlesDir = path.join(this.tempDir, 'subtitles').replace(/\\/g, '/');
    const videosDir = path.join(this.tempDir, 'videos').replace(/\\/g, '/');
    
    await Promise.all([
      ensureDir(imagesDir),
      ensureDir(voicesDir),
      ensureDir(subtitlesDir),
      ensureDir(videosDir)
    ]);
    
    // Thiết lập tùy chọn tải file
    const downloadOptions = {
      taskId: this.id,
      timeout: config.timeouts.download,
      retries: config.retry.maxAttempts,
      retryDelay: config.retry.delay
    };
    
    // Tải tất cả tài nguyên
    for (let i = 0; i < images.length; i++) {
      const imageFile = path.join(imagesDir, `image_${i + 1}.jpg`).replace(/\\/g, '/');
      const voiceFile = path.join(voicesDir, `voice_${i + 1}.mp3`).replace(/\\/g, '/');
      const subtitleFile = subtitles[i] ? path.join(subtitlesDir, `subtitle_${i + 1}.ass`).replace(/\\/g, '/') : null;
      
      // Tải song song các file
      await Promise.all([
        downloadFile(images[i], imageFile, downloadOptions),
        downloadFile(voices[i], voiceFile, downloadOptions),
        subtitles[i] ? processAssSubtitle(subtitles[i], subtitlesDir, { ...downloadOptions, filePrefix: `subtitle_${i + 1}_` }) : null
      ]);
      
      // Lưu đường dẫn tương đối
      this.resources.images.push(path.relative(this.tempDir, imageFile).replace(/\\/g, '/'));
      this.resources.voices.push(path.relative(this.tempDir, voiceFile).replace(/\\/g, '/'));
      if (subtitleFile) {
        this.resources.subtitles.push(path.relative(this.tempDir, subtitleFile).replace(/\\/g, '/'));
      }
    }
    
    logger.task.info(this.id, 'Đã chuẩn bị xong tất cả tài nguyên');
  }

  /**
   * Xử lý từng video riêng biệt
   */
  async processSeparateVideos() {
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

    // Xử lý từng phần video
    for (let i = 0; i < this.resources.images.length; i++) {
      const imagePath = this.resources.images[i];
      const voicePath = this.resources.voices[i];
      const subtitlePath = this.resources.subtitles[i];
      const duration = parseFloat(this.task.durations[i]);
      
      // Tạo video từ ảnh với hiệu ứng Ken Burns
      const frames = Math.round(fps * duration);
      
      // Chọn hiệu ứng Ken Burns ngẫu nhiên
      const kenBurnsEffects = [
        kenBurns.zoomIn,
        kenBurns.panRight,
        kenBurns.panDown,
        kenBurns.zoomOut
      ];
      const effect = kenBurnsEffects[Math.floor(Math.random() * kenBurnsEffects.length)];
      
      let zoompan_filter = `scale=${largeScale}:-1,zoompan=`;
      if (effect.scale) {
        zoompan_filter += `z='${effect.scale.replace('{frames}', frames)}':`;
      }
      zoompan_filter += `x='${effect.x.replace('{frames}', frames)}':`;
      zoompan_filter += `y='${effect.y.replace('{frames}', frames)}':`;
      zoompan_filter += `d=${frames}:s=${video_width}x${video_height}:fps=${fps}`;

      const filter_complex = [
        zoompan_filter,
        'setsar=1',
        'format=yuv420p'
      ].join(',');

      // Tạo video với ảnh và hiệu ứng
      const tempVideoPath = path.join(this.tempDir, `temp_video_${i + 1}.mp4`);
      const outputVideoPath = path.join(this.tempDir, 'videos', `video_${i + 1}.mp4`);

      // Tạo video từ ảnh
      const videoArgs = [
        "-y", "-threads", "0",
        "-loop", "1",
        "-i", path.join(this.tempDir, imagePath),
        "-i", path.join(this.tempDir, voicePath)
      ];

      if (subtitlePath) {
        videoArgs.push("-vf", `${filter_complex},ass=${path.join(this.tempDir, subtitlePath)}`);
      } else {
        videoArgs.push("-vf", filter_complex);
      }

      videoArgs.push(
        "-t", duration.toString(),
        "-c:v", "libx265",
        "-preset", preset,
        "-crf", video_quality.toString(),
        "-pix_fmt", "yuv420p",
        "-c:a", "aac",
        "-b:a", "128k",
        "-shortest",
        outputVideoPath
      );

      await runFFmpeg(videoArgs);
      
      this.resources.separateVideos.push(outputVideoPath);
      logger.task.info(this.id, `Đã tạo xong video ${i + 1}/${this.resources.images.length}`);
    }
  }

  /**
   * Nối các video riêng biệt lại với nhau
   */
  async combineVideos() {
    const { transitions } = ffmpegConfig.effects;
    const transitionDuration = 0.5; // 0.5s cho transition
    
    // Tạo filter complex để nối video
    let filterComplex = '';
    const concatArgs = ["-y", "-threads", "0"];
    
    // Thêm input cho tất cả video
    for (const videoPath of this.resources.separateVideos) {
      concatArgs.push("-i", videoPath);
    }
    
    // Tính toán thời lượng và offset cho từng video
    let currentOffset = 0;
    
    // Tạo filter complex với hiệu ứng xfade
    for (let i = 0; i < this.resources.separateVideos.length - 1; i++) {
      // Chọn hiệu ứng ngẫu nhiên từ danh sách
      const randomTransition = transitions[Math.floor(Math.random() * transitions.length)];
      
      if (i === 0) {
        filterComplex += `[0]`;
      }
      
      // Thêm hiệu ứng xfade với thời lượng 0.4s
      filterComplex += `[${i + 1}]xfade=transition=${randomTransition}:duration=0.4:offset=${currentOffset}`;
      
      if (i < this.resources.separateVideos.length - 2) {
        filterComplex += `[v${i}];[v${i}]`;
      }
      
      // Tính offset cho video tiếp theo
      // Thêm 0.5s transition time
      currentOffset += parseFloat(this.task.durations[i]) + transitionDuration;
    }
    
    // Thêm output label cuối cùng
    filterComplex += '[outv]';
    
    concatArgs.push(
      "-filter_complex", filterComplex,
      "-map", "[outv]",
      "-c:v", "libx265",
      "-preset", "medium",
      "-crf", "23",
      "-pix_fmt", "yuv420p"
    );
    
    // Thêm tham số tối ưu cho H.265
    if (ffmpegConfig.video.x265Params) {
      concatArgs.push("-x265-params", ffmpegConfig.video.x265Params);
      concatArgs.push("-tag:v", "hvc1");
    }
    
    // Output path
    this.outputPath = path.join('output', `output_${this.id}.mp4`);
    await ensureOutputDir(path.dirname(this.outputPath), true);
    
    concatArgs.push(this.outputPath);
    
    await runFFmpeg(concatArgs);
    logger.task.info(this.id, 'Đã nối xong tất cả video');
  }

  /**
   * Thêm tiêu đề vào video cuối cùng
   */
  async addTitle() {
    if (!this.task.titleText) return;

    const tempOutput = path.join(this.tempDir, 'temp_output.mp4');
    
    // Tạo file ASS cho tiêu đề
    const titleAssPath = path.join(this.tempDir, 'title.ass');
    const titleAss = `[Script Info]
ScriptType: v4.00+
PlayResX: ${ffmpegConfig.video.width}
PlayResY: ${ffmpegConfig.video.height}

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Title,Arial,${Math.floor(ffmpegConfig.video.height/15)},&H00FFFFFF,&H000000FF,&H00000000,&H00000000,1,0,0,0,100,100,0,0,1,2,0,2,10,10,10,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,999:00:00.00,Title,,0,0,0,,${this.task.titleText}`;

    fs.writeFileSync(titleAssPath, titleAss);

    // Thêm tiêu đề vào video
    const titleArgs = [
      "-y", "-threads", "0",
      "-i", this.outputPath,
      "-vf", `ass=${titleAssPath}`,
      "-c:v", "libx265",
      "-preset", "medium",
      "-crf", "23",
      "-pix_fmt", "yuv420p",
      "-c:a", "copy",
      tempOutput
    ];

    await runFFmpeg(titleArgs);
    
    // Thay thế file cũ bằng file mới
    fs.renameSync(tempOutput, this.outputPath);
    logger.task.info(this.id, 'Đã thêm tiêu đề vào video');
  }

  /**
   * Dọn dẹp tài nguyên
   */
  async cleanupResources() {
    try {
      if (!this.tempDir) return;

      logger.task.info(this.id, 'Bắt đầu dọn dẹp tài nguyên tạm thời');

      // Xóa các thư mục con
      const subDirs = ['images', 'voices', 'subtitles', 'videos'];
      for (const dir of subDirs) {
        const dirPath = path.join(this.tempDir, dir);
        if (fs.existsSync(dirPath)) {
          await removeDir(dirPath);
        }
      }

      // Xóa các file tạm khác
      const tempFiles = fs.readdirSync(this.tempDir);
      for (const file of tempFiles) {
        const filePath = path.join(this.tempDir, file);
        if (fs.statSync(filePath).isFile()) {
          fs.unlinkSync(filePath);
        }
      }

      // Xóa thư mục tạm
      await removeDir(this.tempDir);
      logger.task.info(this.id, 'Đã dọn dẹp xong tài nguyên tạm thời');
    } catch (error) {
      logger.task.warn(this.id, `Lỗi khi dọn dẹp tài nguyên: ${error.message}`);
    }
  }
}

/**
 * Xử lý task video riêng biệt
 * @param {Object} task - Thông tin task
 * @returns {Promise<Object>} - Kết quả xử lý task
 */
async function processSeparateTask(task) {
  const processor = new SeparateVideoProcessor(task);
  return await processor.process();
}

export {
  processSeparateTask,
  SeparateVideoProcessor
}; 