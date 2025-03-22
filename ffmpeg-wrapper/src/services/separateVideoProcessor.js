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
        const subtitlePath = this.resources.subtitles[i];
        const duration = parseFloat(durations[i]);

        if (!imagePath) {
          throw new Error(`Thiếu ảnh cho video ${i + 1}`);
        }

        if (isNaN(duration) || duration <= 0) {
          throw new Error(`Thời lượng không hợp lệ cho video ${i + 1}: ${durations[i]}`);
        }

        logger.task.info(this.id, `===== Xử lý video ${i + 1}/${this.resources.images.length} =====`);
        logger.task.info(this.id, `- Ảnh: ${imagePath}`);
        logger.task.info(this.id, `- Subtitle: ${subtitlePath || 'không có'}`);
        logger.task.info(this.id, `- Thời lượng: ${duration.toFixed(2)}s`);

        // Kiểm tra tồn tại file ảnh
        const fullImagePath = path.join(this.tempDir, imagePath);

        if (!fs.existsSync(fullImagePath)) {
          throw new Error(`File ảnh không tồn tại: ${fullImagePath}`);
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

        // Tạo video từ ảnh (chỉ video, không audio)
        const videoArgs = [
          "-y", "-threads", "0",
          "-loop", "1",
          "-i", fullImagePath
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
          // Tạo video không có audio
          "-an",
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
  async createBlankVideo(duration = 0.4) {
    const { width, height, frameRate: fps } = ffmpegConfig.video;
    logger.task.info(this.id, `Tạo video trống ${width}x${height} với thời lượng ${duration}s`);

    // Đường dẫn output
    const blankVideoPath = path.join(this.tempDir, 'videos', `blank_${duration}s.mp4`);

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
    logger.task.info(this.id, `Đã tạo xong video trống (${duration}s)`);
    return blankVideoPath;
  }

  /**
   * Kéo dài video cuối cùng thêm thời gian đã chỉ định
   * @param {string} videoPath Đường dẫn video
   * @param {number} extraDuration Thời gian cần kéo dài (giây)
   * @returns {string} Đường dẫn video đã kéo dài
   */
  async extendLastVideo(videoPath, extraDuration = 1) {
    const outputPath = path.join(this.tempDir, 'videos', 'extended_last.mp4');
    logger.task.info(this.id, `Kéo dài video cuối thêm ${extraDuration}s: ${videoPath}`);

    await runFFmpeg([
      "-y", "-i", videoPath,
      "-vf", `tpad=stop_mode=clone:stop_duration=${extraDuration}`,
      "-af", `apad=pad_dur=${extraDuration}`,
      "-c:v", "libx265",
      "-preset", "medium",
      "-crf", "23",
      outputPath
    ]);

    logger.task.info(this.id, `Đã kéo dài video cuối thêm ${extraDuration}s`);
    return outputPath;
  }

  /**
   * Nối các video riêng biệt lại với nhau
   */
  async combineVideos() {
    const { transitions } = ffmpegConfig.effects;
    const transitionDuration = 0.6; // Thời gian transition 0.6s
    logger.task.info(this.id, `Nối ${this.resources.separateVideos.length} video với hiệu ứng chuyển cảnh ${transitionDuration}s`);

    if (this.resources.separateVideos.length === 0) {
      throw new Error('Không có video nào để nối');
    }

    if (this.resources.separateVideos.length === 1) {
      // Nếu chỉ có 1 video, kéo dài video đó thêm 1s và sao chép ra thư mục output
      const extendedVideo = await this.extendLastVideo(this.resources.separateVideos[0], 1);
      this.outputPath = path.join('output', `output_${this.id}.mp4`);
      await ensureOutputDir(path.dirname(this.outputPath), true);
      fs.copyFileSync(extendedVideo, this.outputPath);
      logger.task.info(this.id, 'Chỉ có 1 video, đã kéo dài và sao chép ra thư mục output');
      return;
    }

    try {
      // Tạo thư mục cho các video tạm thời
      const tempDir = path.join(this.tempDir, 'concat_temp');
      await ensureDir(tempDir);

      // Kéo dài video cuối cùng thêm 1s
      const lastIndex = this.resources.separateVideos.length - 1;
      const extendedLastVideo = await this.extendLastVideo(this.resources.separateVideos[lastIndex], 1);
      
      // Thay thế video cuối bằng phiên bản đã kéo dài
      const processedVideos = [...this.resources.separateVideos];
      processedVideos[lastIndex] = extendedLastVideo;
      
      logger.task.info(this.id, `Đã chuẩn bị ${processedVideos.length} video để áp dụng hiệu ứng chuyển cảnh`);

      // BƯỚC 1: Lấy các audio từ mảng đã tải về
      logger.task.info(this.id, `Chuẩn bị ${this.resources.voices.length} file audio đã tải`);
      const audioFiles = [];
      const { durations } = this.task;
      
      // Tạo thư mục chứa audio tạm
      const tempAudioDir = path.join(tempDir, 'audio');
      await ensureDir(tempAudioDir);
      
      // Duyệt qua mảng voices
      for (let i = 0; i < this.resources.voices.length; i++) {
        const voicePath = this.resources.voices[i];
        if (!voicePath) {
          throw new Error(`Thiếu file audio cho video ${i+1}`);
        }
        
        const fullVoicePath = path.join(this.tempDir, voicePath);
        if (!fs.existsSync(fullVoicePath)) {
          throw new Error(`File audio không tồn tại: ${fullVoicePath}`);
        }
        
        // Lưu đường dẫn đầy đủ cho audio
        audioFiles.push(fullVoicePath);
        
        logger.task.info(this.id, `Đã chuẩn bị audio ${i+1}/${this.resources.voices.length}, duration: ${durations[i]}s`);
      }

      // BƯỚC 2: Tạo luồng audio kết hợp riêng biệt
      const combinedAudioPath = path.join(tempDir, 'combined_audio.aac');
      
      // Tạo danh sách filter complex cho audio
      let audioFilterComplex = '';
      let audioInputs = [];
      
      // Thêm tất cả audio inputs vào command
      for (let i = 0; i < audioFiles.length; i++) {
        audioInputs.push('-i', audioFiles[i]);
      }
      
      // Xử lý audio filter complex - kết hợp tất cả audio inputs mà không cắt
      for (let i = 0; i < audioFiles.length; i++) {
        audioFilterComplex += `[${i}:a]`;
      }
      
      // Nối tất cả audio với concat filter
      audioFilterComplex += `concat=n=${audioFiles.length}:v=0:a=1[aout]`;
      
      // Tạo combined audio từ inputs - sử dụng runFFmpeg thay vì spawn cmd
      logger.task.info(this.id, `Tạo combined audio với filter complex: ${audioFilterComplex}`);
      await runFFmpeg([
        '-y', '-threads', '0',
        ...audioInputs,
        '-filter_complex', audioFilterComplex,
        '-map', '[aout]',
        '-c:a', 'aac',
        '-b:a', '128k',
        combinedAudioPath
      ]);
      
      logger.task.info(this.id, `Đã tạo combined audio thành công: ${combinedAudioPath}`);
      
      // BƯỚC 3: Xử lý luồng video với xfade
      logger.task.info(this.id, `Bắt đầu xử lý luồng video với hiệu ứng xfade`);
      
      // Tạo filter complex cho video
      let videoFilterComplex = '';
      let videoInputs = [];
      
      // Thêm tất cả video inputs vào command
      for (let i = 0; i < processedVideos.length; i++) {
        videoInputs.push('-i', processedVideos[i]);
      }
      
      // Bắt đầu với video đầu tiên
      videoFilterComplex += `[0:v]setpts=PTS-STARTPTS[v0]; `;
      
      // Áp dụng xfade cho từng cặp video liên tiếp
      for (let i = 1; i < processedVideos.length; i++) {
        // Chọn hiệu ứng chuyển cảnh ngẫu nhiên
        const transitionIndex = Math.floor(Math.random() * transitions.length);
        const transition = transitions[transitionIndex];
        
        // Lấy thời lượng của video trước
        const prevDuration = parseFloat(durations[i-1]);
        
        // Chuẩn bị video hiện tại
        videoFilterComplex += `[${i}:v]setpts=PTS-STARTPTS[v${i}]; `;
        
        // Offset đảm bảo không cắt nội dung quan trọng
        // Transition bắt đầu ở cuối video với khoảng thời gian phủ định là transitionDuration
        const offset = prevDuration - transitionDuration;
        
        logger.task.info(this.id, `Transition ${i}: hiệu ứng '${transition}', duration=${prevDuration}s, offset=${offset}s`);
        
        // Áp dụng xfade giữa v0 (kết quả đã có) và video tiếp theo
        if (i === 1) {
          videoFilterComplex += `[v0][v1]xfade=transition=${transition}:duration=${transitionDuration}:offset=${offset}[v01]; `;
        } else {
          videoFilterComplex += `[v${i-2}${i-1}][v${i}]xfade=transition=${transition}:duration=${transitionDuration}:offset=${offset}[v${i-1}${i}]; `;
        }
      }
      
      // Mapping output cuối cùng
      const lastOutputLabel = processedVideos.length === 2 ? "v01" : `v${processedVideos.length-2}${processedVideos.length-1}`;
      videoFilterComplex += `[${lastOutputLabel}]`;
      
      // Tạo video với xfade và không có audio - sử dụng runFFmpeg thay vì spawn cmd
      const xfadeOutputPath = path.join(tempDir, 'xfade_output.mp4');
      
      logger.task.info(this.id, `Tạo xfade video với filter complex: ${videoFilterComplex}`);
      await runFFmpeg([
        '-y', '-threads', '0',
        ...videoInputs,
        '-filter_complex', videoFilterComplex,
        '-an',
        '-c:v', 'libx265',
        '-preset', 'medium',
        '-crf', '23',
        '-pix_fmt', 'yuv420p',
        xfadeOutputPath
      ]);
      
      logger.task.info(this.id, `Đã tạo xfade video thành công: ${xfadeOutputPath}`);
      
      // BƯỚC 4: Kết hợp luồng video và audio
      logger.task.info(this.id, `Kết hợp luồng video và audio`);
      const finalOutputPath = path.join(tempDir, 'final_output.mp4');
      
      await runFFmpeg([
        "-y", "-threads", "0",
        "-i", xfadeOutputPath, // Video đã được xfade
        "-i", combinedAudioPath, // Audio đã được nối
        "-c:v", "copy", // Copy video stream
        "-c:a", "aac", // Re-encode audio để đảm bảo tương thích
        "-b:a", "128k",
        "-shortest", // Đảm bảo output không dài hơn input ngắn nhất
        finalOutputPath
      ]);
      
      logger.task.info(this.id, `Đã kết hợp thành công video và audio: ${finalOutputPath}`);
      
      // Sao chép kết quả cuối cùng vào thư mục output
      this.outputPath = path.join('output', `output_${this.id}.mp4`);
      await ensureOutputDir(path.dirname(this.outputPath), true);
      fs.copyFileSync(finalOutputPath, this.outputPath);
      
      logger.task.info(this.id, 'Đã xử lý xong tất cả video với hiệu ứng xfade');
      
    } catch (error) {
      logger.task.error(this.id, `Lỗi trong quá trình nối video: ${error.message}`);
      throw error;
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

    // Chuyển tiêu đề thành chữ hoa
    const uppercaseTitle = this.task.titleText.toUpperCase();

    logger.task.info(this.id, `Thêm tiêu đề: "${uppercaseTitle}"`);

    try {
      // Đường dẫn file tạm 
      const tempOutput = path.join(this.tempDir, 'temp_output.mp4');

      // Tạo file ASS cho tiêu đề
      const titleAssPath = path.join(this.tempDir, 'title.ass');

      // Tạo nội dung tiêu đề với thời lượng 8 giây
      const titleDuration = 8; // 8 giây cho hiệu ứng tiêu đề

      // Import createTitleWithEffect từ subtitleProcessor
      const { createTitleWithEffect } = await import('./subtitleProcessor.js');

      // Phần đầu của file ASS - sử dụng đúng kích thước video
      const { width, height } = ffmpegConfig.video;
      
      // Tạo ASS style với font size lớn hơn và định vị chính giữa
      // Sử dụng ASS color format: &HAABBGGRR (AA=alpha, BB=blue, GG=green, RR=red)
      const titleStyleContent = `[Script Info]
ScriptType: v4.00+
PlayResX: ${width}
PlayResY: ${height}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Title,Bungee Spice,256,&H000000FF,&H00FFFFFF,&H0000E4FF,&H00FFFFFF,-1,0,0,0,110,100,1,0,1,2,2,5,10,10,10,163

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

      // Tạo nội dung Dialogue với hiệu ứng từ subtitleProcessor
      const titleDialogues = createTitleWithEffect(uppercaseTitle, titleDuration);

      // Tạo nội dung file ASS hoàn chỉnh
      const titleContent = titleStyleContent + titleDialogues;

      // Ghi file ASS
      fs.writeFileSync(titleAssPath, titleContent);
      logger.task.info(this.id, `Đã tạo file ASS tiêu đề: ${titleAssPath}`);

      // Đảm bảo thư mục đích tồn tại
      await ensureDir(path.dirname(tempOutput));

      // Thêm tiêu đề vào video
      // Di chuyển -fix_sub_duration trước input file vì nó là input option
      const titleArgs = [
        "-y", "-threads", "0",
        "-fix_sub_duration",
        "-i", this.outputPath,
        "-c:v", "libx265",
        "-preset", "medium",
        "-crf", "23",
        "-pix_fmt", "yuv420p",
        "-filter_complex", `[0:v]ass=${titleAssPath}[v]`,
        "-map", "[v]",
        "-map", "0:a",
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
      logger.task.info(this.id, 'Bỏ qua bước thêm tiêu đề, sử dụng video không có tiêu đề');
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
