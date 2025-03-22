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
  cleanupTaskResources
} from '../utils/fileManager.js';
import { downloadFile } from './fileDownloader.js';
import process from 'process';
import { processAssSubtitle } from './subtitleProcessor.js';
import { spawn } from 'child_process';

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

    // Kiểm tra dữ liệu đầu vào
    this.validateInput();

    // Tạo thư mục tạm thời
    this.tempDir = await createTempDir(this.id);

    // Tải và chuẩn bị tài nguyên
    await this.prepareResources();

    // Xử lý từng phần video riêng biệt
    await this.processSeparateVideos();

    // Nối các video lại với nhau
    await this.combineVideos();

    // Thêm tiêu đề nếu có
    await this.addTitle();

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
   * Kiểm tra tính hợp lệ của dữ liệu đầu vào
   */
  validateInput() {
    const { images, voices, durations, subtitles } = this.task;

    logger.task.info(this.id, 'Bắt đầu kiểm tra dữ liệu đầu vào');

    // Kiểm tra images
    if (!images || !Array.isArray(images) || images.length === 0) {
      throw new Error('Mảng images không hợp lệ hoặc rỗng');
    }

    // Kiểm tra voices
    if (!voices || !Array.isArray(voices) || voices.length === 0) {
      throw new Error('Mảng voices không hợp lệ hoặc rỗng');
    }

    // Kiểm tra durations
    if (!durations || !Array.isArray(durations) || durations.length === 0) {
      throw new Error('Mảng durations không hợp lệ hoặc rỗng');
    }

    // Kiểm tra độ dài các mảng phải bằng nhau
    if (images.length !== voices.length || images.length !== durations.length) {
      throw new Error(`Các mảng đầu vào có độ dài không khớp: images (${images.length}), voices (${voices.length}), durations (${durations.length})`);
    }

    // Kiểm tra subtitles nếu có
    if (subtitles) {
      if (!Array.isArray(subtitles)) {
        throw new Error('Mảng subtitles không hợp lệ');
      }

      if (subtitles.length > 0 && subtitles.length !== images.length) {
        throw new Error(`Mảng subtitles có độ dài không khớp: subtitles (${subtitles.length}), images (${images.length})`);
      }
    }

    // Kiểm tra từng phần tử trong mảng
    for (let i = 0; i < images.length; i++) {
      // Kiểm tra URL ảnh
      if (!images[i] || typeof images[i] !== 'string') {
        throw new Error(`URL ảnh không hợp lệ tại vị trí ${i}: ${images[i]}`);
      }

      // Kiểm tra URL voice
      if (!voices[i] || typeof voices[i] !== 'string') {
        throw new Error(`URL voice không hợp lệ tại vị trí ${i}: ${voices[i]}`);
      }

      // Kiểm tra duration
      const duration = parseFloat(durations[i]);
      if (isNaN(duration) || duration <= 0) {
        throw new Error(`Thời lượng không hợp lệ tại vị trí ${i}: ${durations[i]}`);
      }

      // Kiểm tra subtitle nếu có
      if (subtitles && subtitles[i] && typeof subtitles[i] !== 'string') {
        throw new Error(`URL subtitle không hợp lệ tại vị trí ${i}: ${subtitles[i]}`);
      }
    }

    logger.task.info(this.id, `Kiểm tra dữ liệu đầu vào thành công: ${images.length} video sẽ được xử lý`);

    return true;
  }

  /**
   * Tải và chuẩn bị tài nguyên
   */
  async prepareResources() {
    const { images, voices, subtitles, durations } = this.task;

    logger.task.info(this.id, `Chuẩn bị tài nguyên cho ${images.length} video riêng biệt`);

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

    // Khởi tạo mảng resources với độ dài cố định
    this.resources.images = new Array(images.length).fill(null);
    this.resources.voices = new Array(voices.length).fill(null);
    this.resources.subtitles = new Array(subtitles.length).fill(null);

    // Thiết lập tùy chọn tải file
    const downloadOptions = {
      taskId: this.id,
      timeout: config.timeouts.download,
      retries: config.retry.maxAttempts,
      retryDelay: config.retry.delay
    };

    // Xử lý tuần tự từng cặp theo đúng index
    for (let i = 0; i < images.length; i++) {
      const imageFile = path.join(imagesDir, `image_${i + 1}.jpg`).replace(/\\/g, '/');
      const voiceFile = path.join(voicesDir, `voice_${i + 1}.mp3`).replace(/\\/g, '/');

      logger.task.info(this.id, `===== Xử lý tài nguyên cho video ${i + 1}/${images.length} =====`);
      logger.task.info(this.id, `- Image: ${images[i]}`);
      logger.task.info(this.id, `- Voice: ${voices[i]}`);
      logger.task.info(this.id, `- Subtitle: ${subtitles[i] || 'không có'}`);
      logger.task.info(this.id, `- Duration: ${durations[i]}s`);

      try {
        // Tải song song ảnh và voice
        const [, , subtitleFilePath] = await Promise.all([
          downloadFile(images[i], imageFile, downloadOptions),
          downloadFile(voices[i], voiceFile, downloadOptions),
          // Xử lý subtitle nếu có
          subtitles[i] ? processAssSubtitle(
            subtitles[i],
            subtitlesDir,
            { ...downloadOptions, filePrefix: `subtitle_${i + 1}` }
          ) : Promise.resolve(null)
        ]);

        // Lưu đường dẫn tương đối
        this.resources.images[i] = path.relative(this.tempDir, imageFile).replace(/\\/g, '/');
        this.resources.voices[i] = path.relative(this.tempDir, voiceFile).replace(/\\/g, '/');

        // Lưu đường dẫn subtitle nếu có
        if (subtitleFilePath) {
          const relativePath = path.relative(this.tempDir, subtitleFilePath).replace(/\\/g, '/');
          this.resources.subtitles[i] = relativePath;
          logger.task.info(this.id, `Đã lưu subtitle ${i + 1}: ${relativePath}`);
        } else {
          this.resources.subtitles[i] = null;
          logger.task.info(this.id, `Không có subtitle cho video ${i + 1}`);
        }

        logger.task.info(this.id, `Đã xử lý xong tài nguyên cho video ${i + 1}`);
      } catch (error) {
        logger.task.error(this.id, `Lỗi xử lý tài nguyên cho video ${i + 1}: ${error.message}`);
        throw error;
      }
    }

    logger.task.info(this.id, 'Đã chuẩn bị xong tất cả tài nguyên');
    logger.task.info(this.id, `- Số lượng ảnh: ${this.resources.images.filter(Boolean).length}/${images.length}`);
    logger.task.info(this.id, `- Số lượng âm thanh: ${this.resources.voices.filter(Boolean).length}/${voices.length}`);
    logger.task.info(this.id, `- Số lượng phụ đề: ${this.resources.subtitles.filter(Boolean).length}/${subtitles.length}`);
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
    const { durations } = this.task;

    logger.task.info(this.id, `Bắt đầu xử lý ${this.resources.images.length} video riêng biệt`);

    // Mảng để lưu trữ các đường dẫn video đã tạo thành công
    this.resources.separateVideos = [];

    // Xử lý tuần tự từng video theo đúng index
    for (let i = 0; i < this.resources.images.length; i++) {
      try {
        const imagePath = this.resources.images[i];
        const voicePath = this.resources.voices[i];
        const subtitlePath = this.resources.subtitles[i];
        const duration = parseFloat(durations[i]);

        if (!imagePath || !voicePath) {
          throw new Error(`Thiếu tài nguyên cơ bản cho video ${i + 1}`);
        }

        if (isNaN(duration) || duration <= 0) {
          throw new Error(`Thời lượng không hợp lệ cho video ${i + 1}: ${durations[i]}`);
        }

        logger.task.info(this.id, `===== Xử lý video ${i + 1}/${this.resources.images.length} =====`);
        logger.task.info(this.id, `- Ảnh: ${imagePath}`);
        logger.task.info(this.id, `- Voice: ${voicePath}`);
        logger.task.info(this.id, `- Subtitle: ${subtitlePath || 'không có'}`);
        logger.task.info(this.id, `- Thời lượng: ${duration.toFixed(2)}s`);

        // Kiểm tra tồn tại file ảnh và voice
        const fullImagePath = path.join(this.tempDir, imagePath);
        const fullVoicePath = path.join(this.tempDir, voicePath);

        if (!fs.existsSync(fullImagePath)) {
          throw new Error(`File ảnh không tồn tại: ${fullImagePath}`);
        }

        if (!fs.existsSync(fullVoicePath)) {
          throw new Error(`File âm thanh không tồn tại: ${fullVoicePath}`);
        }

        // Tạo video từ ảnh với hiệu ứng Ken Burns
        const frames = Math.round(fps * duration);

        // Chọn hiệu ứng Ken Burns theo thứ tự để đảm bảo đa dạng
        const kenBurnsEffects = [
          { name: 'zoomIn', config: kenBurns.zoomIn },
          { name: 'panRight', config: kenBurns.panRight },
          { name: 'panDown', config: kenBurns.panDown },
          { name: 'zoomOut', config: kenBurns.zoomOut }
        ];

        // Chọn hiệu ứng theo index để đảm bảo mỗi video có hiệu ứng khác nhau
        const effectIndex = i % kenBurnsEffects.length;
        const effect = kenBurnsEffects[effectIndex];

        logger.task.info(this.id, `- Áp dụng hiệu ứng Ken Burns: ${effect.name}`);

        // Tạo filter zoompan
        let zoompan_filter = `scale=${largeScale}:-1,zoompan=`;

        // Đảm bảo tất cả tham số đều được thay thế đúng
        const scaleValue = effect.config.scale ? effect.config.scale.replace('{frames}', frames) : '1';
        const xValue = effect.config.x.replace('{frames}', frames);
        const yValue = effect.config.y.replace('{frames}', frames);

        zoompan_filter += `z='${scaleValue}':x='${xValue}':y='${yValue}':`;
        zoompan_filter += `d=${frames}:s=${video_width}x${video_height}:fps=${fps}`;

        // Thêm các filter khác
        const filter_complex = [
          zoompan_filter,
          'setsar=1',
          'format=yuv420p'
        ].join(',');

        logger.task.info(this.id, `- Filter complex: ${filter_complex}`);

        // Đường dẫn đầu ra
        const outputVideoPath = path.join(this.tempDir, 'videos', `video_${i + 1}.mp4`);

        // Tạo video từ ảnh
        const videoArgs = [
          "-y", "-threads", "0",
          "-loop", "1",
          "-i", fullImagePath,
          "-i", fullVoicePath
        ];

        // Kiểm tra và xử lý subtitle
        let subtitleFullPath = null;
        if (subtitlePath) {
          subtitleFullPath = path.join(this.tempDir, subtitlePath);
          if (!fs.existsSync(subtitleFullPath)) {
            logger.task.warn(this.id, `Subtitle không tồn tại: ${subtitleFullPath}, sẽ bỏ qua subtitle.`);
            subtitleFullPath = null;
          } else {
            logger.task.info(this.id, `Sử dụng subtitle: ${subtitleFullPath}`);
          }
        }

        // Thêm filter video (với hoặc không có subtitle)
        if (subtitleFullPath) {
          videoArgs.push("-vf", `${filter_complex},ass=${subtitleFullPath}`);
        } else {
          videoArgs.push("-vf", filter_complex);
        }

        // Thêm các tham số còn lại
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

        logger.task.info(this.id, `Bắt đầu tạo video ${i + 1}...`);
        await runFFmpeg(videoArgs);

        this.resources.separateVideos.push(outputVideoPath);
        logger.task.info(this.id, `Đã tạo xong video ${i + 1}/${this.resources.images.length}`);

      } catch (error) {
        logger.task.error(this.id, `Lỗi khi xử lý video ${i + 1}: ${error.message}`);
        throw error; // Ném lỗi để dừng toàn bộ quá trình
      }
    }

    // Kiểm tra nếu không có video nào được tạo
    if (this.resources.separateVideos.length === 0) {
      throw new Error('Không có video nào được tạo thành công');
    }

    logger.task.info(this.id, `Đã xử lý xong ${this.resources.separateVideos.length}/${this.resources.images.length} video riêng biệt`);
  }

  /**
   * Tạo video trống để sử dụng làm video trung gian cho hiệu ứng xfade
   * @returns {string} Đường dẫn đến video trống
   */
  async createBlankVideo() {
    const { width, height, frameRate: fps } = ffmpegConfig.video;
    const duration = 0.4; // Thời lượng 0.4s cho video trống
    logger.task.info(this.id, `Tạo video trống ${width}x${height} với thời lượng ${duration}s`);

    // Đường dẫn output
    const blankVideoPath = path.join(this.tempDir, 'videos', 'blank.mp4');

    // Tạo video trống với màu đen VÀ audio silence
    const args = [
      "-y", "-threads", "0",
      "-f", "lavfi",
      "-i", `color=c=black:s=${width}x${height}:r=${fps}:d=${duration}`,
      // Thêm nguồn audio silence
      "-f", "lavfi",
      "-i", `anullsrc=r=48000:cl=stereo:d=${duration}`,
      "-c:v", "libx265",
      "-preset", "medium",
      "-crf", "23",
      "-pix_fmt", "yuv420p",
      // Thiết lập codec audio
      "-c:a", "aac",
      "-b:a", "128k",
      blankVideoPath
    ];

    await runFFmpeg(args);
    logger.task.info(this.id, 'Đã tạo xong video trống');
    return blankVideoPath;
  }

  /**
   * Nối các video riêng biệt lại với nhau
   */
  async combineVideos() {
    const { transitions } = ffmpegConfig.effects;
    const transitionDuration = 0.4; // 0.4s cho hiệu ứng transition
    
    // Lấy cấu hình sử dụng blank buffer từ config (nếu có) hoặc mặc định là false
    const useBlankBuffer = ffmpegConfig.effects?.useBlankBuffer || false;
    
    logger.task.info(this.id, `Nối ${this.resources.separateVideos.length} video với hiệu ứng chuyển cảnh ${transitionDuration}s` + 
      (useBlankBuffer ? " (sử dụng video trống làm buffer)" : ""));

    if (this.resources.separateVideos.length === 0) {
      throw new Error('Không có video nào để nối');
    }

    if (this.resources.separateVideos.length === 1) {
      // Nếu chỉ có 1 video, mở rộng video cuối rồi sao chép ra thư mục output
      const extendedVideo = await this.extendLastVideo(this.resources.separateVideos[0], 1.0);
      this.outputPath = path.join('output', `output_${this.id}.mp4`);
      await ensureOutputDir(path.dirname(this.outputPath), true);
      fs.copyFileSync(extendedVideo, this.outputPath);
      logger.task.info(this.id, 'Chỉ có 1 video, đã kéo dài và sao chép trực tiếp ra thư mục output');
      return;
    }

    try {
      // Tạo thư mục cho các video tạm thời
      const tempDir = path.join(this.tempDir, 'concat_temp');
      await ensureDir(tempDir);

      // Tạo video trống nếu cần
      let blankVideoPath = null;
      if (useBlankBuffer) {
        blankVideoPath = await this.createBlankVideo();
        logger.task.info(this.id, `Đã tạo video trống làm buffer: ${blankVideoPath}`);
      }

      // Bắt đầu với video đầu tiên
      let currentVideo = this.resources.separateVideos[0];

      // Nối từng cặp video một
      for (let i = 1; i < this.resources.separateVideos.length; i++) {
        const nextVideo = this.resources.separateVideos[i];
        
        // Nếu sử dụng video trống làm buffer cho transition
        if (useBlankBuffer) {
          // Nối video hiện tại với video trống
          const tempPath1 = path.join(tempDir, `temp1_${i}.mp4`);
          // Chọn hiệu ứng chuyển cảnh
          const transitionIndex1 = Math.floor(Math.random() * transitions.length);
          const transition1 = transitions[transitionIndex1];
          
          // Lấy thời lượng của video hiện tại
          const duration1 = await this.getVideoDuration(currentVideo);
          const offset1 = Math.max(0, duration1 - transitionDuration * 1.2);
          
          logger.task.info(this.id, `Transition ${i}-1: video -> blank với hiệu ứng '${transition1}'`);
          
          // Tạo chuỗi filter complex
          const filter_complex1 = 
            `[0:v][1:v]xfade=transition=${transition1}:duration=${transitionDuration}:offset=${offset1}[v];` +
            `[0:a]atrim=0:${duration1}[a1];` +
            `[1:a]adelay=${Math.round(offset1*1000)}|${Math.round(offset1*1000)}[a2];` +
            `[a1][a2]amix=inputs=2:duration=longest:dropout_transition=${transitionDuration}[a]`;
          
          // Ghi log chi tiết filter
          logger.task.info(this.id, `Filter complex 1: ${filter_complex1}`);
          
          try {
            // Nối video hiện tại với video trống - sử dụng cách tốt hơn cho audio sync
            await runFFmpeg([
              "-y", "-threads", "0",
              "-i", currentVideo,
              "-i", blankVideoPath,
              "-filter_complex", filter_complex1,
              "-map", "[v]", "-map", "[a]",
              "-c:v", "libx265",
              "-preset", "medium",
              "-crf", "23",
              "-pix_fmt", "yuv420p",
              tempPath1
            ]);
            
            logger.task.info(this.id, `Đã tạo video trung gian 1 thành công: ${tempPath1}`);
          } catch (error) {
            logger.task.error(this.id, `Lỗi khi tạo video trung gian 1: ${error.message}`);
            throw error;
          }
          
          // Nối video trống với video tiếp theo
          const tempPath2 = path.join(tempDir, `xfade_${i}.mp4`);
          // Chọn hiệu ứng chuyển cảnh khác cho phần 2
          const transitionIndex2 = Math.floor(Math.random() * transitions.length);
          const transition2 = transitions[transitionIndex2];
          
          // Lấy thời lượng của video trống
          const duration2 = await this.getVideoDuration(tempPath1);
          const offset2 = Math.max(0, duration2 - transitionDuration * 1.2);
          
          logger.task.info(this.id, `Transition ${i}-2: blank -> video với hiệu ứng '${transition2}'`);
          
          // Tạo chuỗi filter complex
          const filter_complex2 = 
            `[0:v][1:v]xfade=transition=${transition2}:duration=${transitionDuration}:offset=${offset2}[v];` +
            `[0:a]atrim=0:${duration2}[a1];` +
            `[1:a]adelay=${Math.round(offset2*1000)}|${Math.round(offset2*1000)}[a2];` +
            `[a1][a2]amix=inputs=2:duration=longest:dropout_transition=${transitionDuration}[a]`;
          
          // Ghi log chi tiết filter
          logger.task.info(this.id, `Filter complex 2: ${filter_complex2}`);
          
          try {
            // Nối video trống với video tiếp theo - sử dụng cách tốt hơn cho audio sync
            await runFFmpeg([
              "-y", "-threads", "0",
              "-i", tempPath1,
              "-i", nextVideo,
              "-filter_complex", filter_complex2,
              "-map", "[v]", "-map", "[a]",
              "-c:v", "libx265",
              "-preset", "medium",
              "-crf", "23",
              "-pix_fmt", "yuv420p",
              tempPath2
            ]);
            
            logger.task.info(this.id, `Đã tạo video trung gian 2 thành công: ${tempPath2}`);
            // Cập nhật video hiện tại
            currentVideo = tempPath2;
          } catch (error) {
            logger.task.error(this.id, `Lỗi khi tạo video trung gian 2: ${error.message}`);
            throw error;
          }
        } else {
          // Phương pháp nối video trực tiếp (không dùng buffer)
          const outputPath = path.join(tempDir, `xfade_${i}.mp4`);
          
          // Chọn hiệu ứng chuyển cảnh
          const transitionIndex = Math.floor(Math.random() * transitions.length);
          const transition = transitions[transitionIndex];
          logger.task.info(this.id, `Transition ${i}: sử dụng hiệu ứng '${transition}'`);

          // Lấy thời lượng của video hiện tại
          const duration = await this.getVideoDuration(currentVideo);
          
          // Điều chỉnh offset để tránh video sau bắt đầu quá sớm (thêm buffer)
          const offset = Math.max(0, duration - transitionDuration * 1.2);
          
          logger.task.info(this.id, `Áp dụng transition với duration=${transitionDuration}s, offset=${offset}s (từ video dài ${duration}s)`);

          // Tạo chuỗi filter complex
          const filter_complex = 
            `[0:v][1:v]xfade=transition=${transition}:duration=${transitionDuration}:offset=${offset}[v];` +
            `[0:a]atrim=0:${duration}[a1];` +
            `[1:a]adelay=${Math.round(offset*1000)}|${Math.round(offset*1000)}[a2];` +
            `[a1][a2]amix=inputs=2:duration=longest:dropout_transition=${transitionDuration}[a]`;
          
          // Ghi log chi tiết filter
          logger.task.info(this.id, `Filter complex: ${filter_complex}`);
          
          try {
            // Nối với hiệu ứng xfade - sử dụng cách tốt hơn cho audio sync
            await runFFmpeg([
              "-y", "-threads", "0",
              "-i", currentVideo,
              "-i", nextVideo,
              "-filter_complex", filter_complex,
              "-map", "[v]", "-map", "[a]",
              "-c:v", "libx265",
              "-preset", "medium",
              "-crf", "23",
              "-pix_fmt", "yuv420p",
              outputPath
            ]);
            
            logger.task.info(this.id, `Đã tạo video kết hợp thành công: ${outputPath}`);
            // Cập nhật video hiện tại cho lần nối tiếp theo
            currentVideo = outputPath;
          } catch (error) {
            logger.task.error(this.id, `Lỗi khi tạo video kết hợp: ${error.message}`);
            throw error;
          }
        }
        
        // Nếu đây là video cuối cùng trong chuỗi, kéo dài thêm 1s
        if (i === this.resources.separateVideos.length - 1) {
          logger.task.info(this.id, 'Đã đến video cuối cùng, kéo dài thêm 1s');
          currentVideo = await this.extendLastVideo(currentVideo, 1.0);
        }
      }

      // Sao chép kết quả cuối cùng vào thư mục output
      this.outputPath = path.join('output', `output_${this.id}.mp4`);
      await ensureOutputDir(path.dirname(this.outputPath), true);
      fs.copyFileSync(currentVideo, this.outputPath);

      logger.task.info(this.id, 'Đã nối xong tất cả video với hiệu ứng xfade');
    } catch (error) {
      logger.task.error(this.id, `Lỗi trong quá trình nối video: ${error.message}`);
      throw error;
    }
  }

  /**
   * Kéo dài video cuối thêm một khoảng thời gian
   * @param {string} videoPath Đường dẫn đến video cần kéo dài
   * @param {number} extraDuration Thời gian cần kéo dài thêm (giây)
   * @returns {string} Đường dẫn đến video đã được kéo dài
   */
  async extendLastVideo(videoPath, extraDuration = 1.0) {
    logger.task.info(this.id, `Kéo dài video thêm ${extraDuration}s: ${videoPath}`);
    
    // Đường dẫn đầu ra
    const outputPath = path.join(this.tempDir, 'extended_last.mp4');
    
    try {
      // Sử dụng tpad để kéo dài video và apad để kéo dài audio
      await runFFmpeg([
        "-y", "-threads", "0",
        "-i", videoPath,
        "-vf", `tpad=stop_mode=clone:stop_duration=${extraDuration}`,
        "-af", `apad=pad_dur=${extraDuration}`,
        "-c:v", "libx265",
        "-preset", "medium",
        "-crf", "23",
        "-pix_fmt", "yuv420p",
        outputPath
      ]);
      
      logger.task.info(this.id, `Đã kéo dài video thành công: ${outputPath}`);
      return outputPath;
    } catch (error) {
      logger.task.error(this.id, `Lỗi khi kéo dài video: ${error.message}`);
      logger.task.info(this.id, 'Sẽ sử dụng video gốc không kéo dài');
      return videoPath;
    }
  }

  // Thêm hàm hỗ trợ để lấy thời lượng video
  async getVideoDuration(videoPath) {
    return new Promise((resolve, reject) => {
      // Kiểm tra file tồn tại
      if (!fs.existsSync(videoPath)) {
        return reject(new Error(`File video không tồn tại: ${videoPath}`));
      }

      const ffprobe = spawn('ffprobe', [
        '-v', 'error',
        '-show_entries', 'format=duration',
        '-of', 'default=noprint_wrappers=1:nokey=1',
        videoPath
      ]);

      let output = '';
      let errorOutput = '';

      ffprobe.stdout.on('data', (data) => {
        output += data.toString();
      });

      ffprobe.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });

      ffprobe.on('close', (code) => {
        if (code !== 0) {
          return reject(new Error(`Không thể lấy thời lượng video: ${videoPath}. Lỗi: ${errorOutput}`));
        }
        
        const duration = parseFloat(output.trim());
        if (isNaN(duration) || duration <= 0) {
          return reject(new Error(`Thời lượng video không hợp lệ: ${output.trim()}`));
        }
        
        resolve(duration);
      });

      ffprobe.on('error', (err) => {
        if (err.code === 'ENOENT') {
          reject(new Error('Không tìm thấy ffprobe. Vui lòng cài đặt ffmpeg và ffprobe.'));
        } else {
          reject(new Error(`Lỗi khi chạy ffprobe: ${err.message}`));
        }
      });
    });
  }

  /**
   * Thêm tiêu đề vào video cuối cùng
   */
  async addTitle() {
    if (!this.task.titleText) {
      logger.task.info(this.id, 'Không có tiêu đề, bỏ qua bước thêm tiêu đề');
      return;
    }

    // Kiểm tra xem file output có tồn tại không
    if (!fs.existsSync(this.outputPath)) {
      logger.task.error(this.id, `Không thể thêm tiêu đề vì file đầu ra không tồn tại: ${this.outputPath}`);
      return;
    }

    logger.task.info(this.id, `Thêm tiêu đề: "${this.task.titleText}"`);

    try {
      // Import các hàm từ subtitleProcessor.js
      const { createTitleWithEffect, createCombinedAss } = await import('./subtitleProcessor.js');
      
      if (!createTitleWithEffect || !createCombinedAss) {
        throw new Error('Không tìm thấy các hàm cần thiết từ subtitleProcessor.js');
      }
      
      logger.task.info(this.id, 'Đã import thành công các hàm từ subtitleProcessor.js');

      // Đường dẫn file tạm và thư mục
      const tempOutput = path.join(this.tempDir, 'temp_output.mp4');
      const subtitlesDir = path.join(this.tempDir, 'title_subtitles');
      await ensureDir(subtitlesDir);

      // Tạo file ASS ban đầu với nội dung cơ bản
      const initialAssPath = path.join(subtitlesDir, 'initial.ass');
      
      // Sử dụng kích thước video từ config
      const { width, height } = ffmpegConfig.video;
      
      // Tạo một file ASS cơ bản
      const basicAssContent = `[Script Info]
ScriptType: v4.00+
PlayResX: ${width}
PlayResY: ${height}

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,48,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,0,2,10,10,10,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
      
      // Ghi file ASS ban đầu
      fs.writeFileSync(initialAssPath, basicAssContent);
      
      // Sử dụng createCombinedAss để tạo file ASS hoàn chỉnh với tiêu đề
      const titleAssPath = await createCombinedAss(
        initialAssPath, 
        this.task.titleText, 
        subtitlesDir, 
        this.id
      );
      
      logger.task.info(this.id, `Đã tạo file ASS tiêu đề với createCombinedAss: ${titleAssPath}`);

      // Đảm bảo thư mục đích tồn tại
      await ensureDir(path.dirname(tempOutput));

      // Thêm tiêu đề vào video - sử dụng libx265 để duy trì chất lượng
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

      logger.task.info(this.id, 'Thêm tiêu đề vào video...');
      await runFFmpeg(titleArgs);

      // Thay thế file cũ bằng file mới
      if (fs.existsSync(tempOutput)) {
        fs.renameSync(tempOutput, this.outputPath);
        logger.task.info(this.id, 'Đã thêm tiêu đề vào video thành công');
      } else {
        throw new Error('Không tìm thấy file temp_output.mp4 sau khi xử lý');
      }

      // Lưu file ASS ra thư mục output để kiểm tra nếu cần
      try {
        const debugAssPath = path.join('output', `title_${this.id}.ass`);
        await ensureOutputDir(path.dirname(debugAssPath), true);
        fs.copyFileSync(titleAssPath, debugAssPath);
        logger.task.info(this.id, `Đã lưu file ASS tiêu đề để kiểm tra: ${debugAssPath}`);
      } catch (debugError) {
        logger.task.warn(this.id, `Không thể lưu file ASS tiêu đề để kiểm tra: ${debugError.message}`);
      }
    } catch (error) {
      logger.task.error(this.id, `Lỗi khi thêm tiêu đề: ${error.message}`);
      logger.task.info(this.id, 'Bỏ qua bước thêm tiêu đề');
    }
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