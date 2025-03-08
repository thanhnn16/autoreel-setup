import express from 'express';
import { spawn } from 'child_process';
import fs from 'fs';
import fetch from 'node-fetch';
import path from 'path';
import { format } from 'util';

const app = express();
app.use(express.json());

// Thiết lập thư mục logs
const logsDir = './logs';
if (!fs.existsSync(logsDir)) {
  try {
    fs.mkdirSync(logsDir, { recursive: true });
    console.log(`Đã tạo thư mục logs: ${path.resolve(logsDir)}`);
  } catch (error) {
    console.error(`Không thể tạo thư mục logs: ${error.message}`);
  }
}

// Tạo file log cho server
const serverLogFile = path.join(logsDir, 'server.log');

// Hàm ghi log
function writeLog(message, level = 'INFO') {
  try {
    const timestamp = new Date().toISOString();
    const formattedMessage = `[${timestamp}] [${level}] ${message}\n`;

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
    console.error(`Lỗi khi ghi log: ${error.message}`);
  }
}

// Override console.log và console.error để ghi logs
const originalConsoleLog = console.log;
const originalConsoleError = console.error;

console.log = function () {
  try {
    const message = format.apply(null, arguments);
    originalConsoleLog.apply(console, arguments);

    // Đảm bảo thư mục logs tồn tại
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }

    fs.appendFileSync(serverLogFile, `[${new Date().toISOString()}] [INFO] ${message}\n`);
  } catch (error) {
    originalConsoleLog(`Lỗi khi ghi log: ${error.message}`);
  }
};

console.error = function () {
  try {
    const message = format.apply(null, arguments);
    originalConsoleError.apply(console, arguments);

    // Đảm bảo thư mục logs tồn tại
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }

    fs.appendFileSync(serverLogFile, `[${new Date().toISOString()}] [ERROR] ${message}\n`);
  } catch (error) {
    originalConsoleError(`Lỗi khi ghi log: ${error.message}`);
  }
};

// Hàm chạy ffmpeg và trả về Promise
function runFFmpeg(args) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    // Use the original console functions to avoid duplicate logging
    originalConsoleLog(`[FFmpeg] Bắt đầu thực thi lệnh: ffmpeg ${args.join(' ')}`);
    // Still write to log file
    fs.appendFileSync(serverLogFile, `[${new Date().toISOString()}] [INFO] [FFmpeg] Bắt đầu thực thi lệnh: ffmpeg ${args.join(' ')}\n`);

    const ffmpeg = spawn('ffmpeg', args);
    let stdout = '';
    let stderr = '';

    ffmpeg.stdout.on('data', (data) => {
      const chunk = data.toString();
      stdout += chunk;
      // Có thể log ra từng phần output nếu cần
      // originalConsoleLog(`[FFmpeg] stdout: ${chunk}`);
    });

    ffmpeg.stderr.on('data', (data) => {
      const chunk = data.toString();
      stderr += chunk;
      // FFmpeg thường ghi log vào stderr, kể cả khi không có lỗi
      // Chỉ log ra các thông báo lỗi quan trọng
      if (chunk.includes('Error') || chunk.includes('error') || chunk.includes('failed')) {
        originalConsoleError(`[FFmpeg] stderr: ${chunk}`);
        fs.appendFileSync(serverLogFile, `[${new Date().toISOString()}] [ERROR] [FFmpeg] stderr: ${chunk}\n`);
      }
    });

    ffmpeg.on('error', (error) => {
      const duration = (Date.now() - startTime) / 1000;
      originalConsoleError(`[FFmpeg] Lỗi khi khởi chạy process (${duration}s): ${error.message}`);
      fs.appendFileSync(serverLogFile, `[${new Date().toISOString()}] [ERROR] [FFmpeg] Lỗi khi khởi chạy process (${duration}s): ${error.message}\n`);
      reject({
        code: -1,
        stdout,
        stderr,
        error: error.message,
        duration,
        command: `ffmpeg ${args.join(' ')}`
      });
    });

    ffmpeg.on('close', (code) => {
      const duration = (Date.now() - startTime) / 1000;
      if (code === 0) {
        originalConsoleLog(`[FFmpeg] Thực thi thành công (${duration}s)`);
        fs.appendFileSync(serverLogFile, `[${new Date().toISOString()}] [INFO] [FFmpeg] Thực thi thành công (${duration}s)\n`);
        resolve({
          code,
          stdout,
          stderr,
          duration,
          command: `ffmpeg ${args.join(' ')}`
        });
      } else {
        originalConsoleError(`[FFmpeg] Thực thi thất bại với mã lỗi ${code} (${duration}s)`);
        fs.appendFileSync(serverLogFile, `[${new Date().toISOString()}] [ERROR] [FFmpeg] Thực thi thất bại với mã lỗi ${code} (${duration}s)\n`);
        reject({
          code,
          stdout,
          stderr,
          duration,
          command: `ffmpeg ${args.join(' ')}`
        });
      }
    });
  });
}

// Hàm chạy ffprobe và trả về Promise
function runFFprobe(args) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    originalConsoleLog(`[FFprobe] Bắt đầu thực thi lệnh: ffprobe ${args.join(' ')}`);
    fs.appendFileSync(serverLogFile, `[${new Date().toISOString()}] [INFO] [FFprobe] Bắt đầu thực thi lệnh: ffprobe ${args.join(' ')}\n`);

    const ffprobe = spawn('ffprobe', args);
    let stdout = '';
    let stderr = '';

    ffprobe.stdout.on('data', (data) => {
      const chunk = data.toString();
      stdout += chunk;
    });

    ffprobe.stderr.on('data', (data) => {
      const chunk = data.toString();
      stderr += chunk;
      if (chunk.includes('Error') || chunk.includes('error') || chunk.includes('failed')) {
        originalConsoleError(`[FFprobe] stderr: ${chunk}`);
        fs.appendFileSync(serverLogFile, `[${new Date().toISOString()}] [ERROR] [FFprobe] stderr: ${chunk}\n`);
      }
    });

    ffprobe.on('error', (error) => {
      const duration = (Date.now() - startTime) / 1000;
      originalConsoleError(`[FFprobe] Lỗi khi khởi chạy process (${duration}s): ${error.message}`);
      fs.appendFileSync(serverLogFile, `[${new Date().toISOString()}] [ERROR] [FFprobe] Lỗi khi khởi chạy process (${duration}s): ${error.message}\n`);
      reject({
        code: -1,
        stdout,
        stderr,
        error: error.message,
        duration,
        command: `ffprobe ${args.join(' ')}`
      });
    });

    ffprobe.on('close', (code) => {
      const duration = (Date.now() - startTime) / 1000;
      if (code === 0) {
        originalConsoleLog(`[FFprobe] Thực thi thành công (${duration}s)`);
        fs.appendFileSync(serverLogFile, `[${new Date().toISOString()}] [INFO] [FFprobe] Thực thi thành công (${duration}s)\n`);
        resolve({
          code,
          stdout,
          stderr,
          duration,
          command: `ffprobe ${args.join(' ')}`
        });
      } else {
        originalConsoleError(`[FFprobe] Thực thi thất bại với mã lỗi ${code} (${duration}s)`);
        fs.appendFileSync(serverLogFile, `[${new Date().toISOString()}] [ERROR] [FFprobe] Thực thi thất bại với mã lỗi ${code} (${duration}s)\n`);
        reject({
          code,
          stdout,
          stderr,
          duration,
          command: `ffprobe ${args.join(' ')}`
        });
      }
    });
  });
}

// Endpoint gốc: chạy ffmpeg với các tham số truyền vào
app.post('/ffmpeg', (req, res) => {
  const args = req.body.args;
  if (!args || !Array.isArray(args)) {
    return res.status(400).send({ error: 'args is required and must be an array' });
  }

  const ffmpeg = spawn('ffmpeg', args);
  let stdout = '';
  let stderr = '';

  ffmpeg.stdout.on('data', (data) => { stdout += data.toString(); });
  ffmpeg.stderr.on('data', (data) => { stderr += data.toString(); });

  ffmpeg.on('close', (code) => {
    res.send({ code, stdout, stderr });
  });
});

// Hàm định dạng thời gian cho ASS
function formatAssTime(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 100);
  
  return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
}

// Hàm tạo dòng tiêu đề
function createTitleLine(options) {
  const {
    titleText,
    titleColor1 = "FFFFFF", // Default: Màu chữ (trắng tinh khiết)
    titleColor2 = "FFFFFF", // Không sử dụng nữa
    titleDuration = 3       // Default: Thời gian hiển thị (giây)
  } = options;

  // Không tạo tiêu đề nếu không có text
  if (!titleText || titleText.trim() === '') {
    return '';
  }

  // Thời gian hiển thị
  const startTime = 0;
  const endTime = titleDuration;

  // Phong cách 2025: Tối giản, thanh lịch, tinh tế
  // Đặt tiêu đề chính giữa màn hình (cả ngang và dọc)
  // Sử dụng font San-serif hiện đại hỗ trợ tiếng Việt UTF-8
  // Thêm blur nền để làm nổi bật chữ trên mọi hình nền
  // Hiệu ứng fade in/out mượt mà (500ms)
  // Vị trí: x=256 (giữa ngang), y=384 (giữa dọc) cho video 512x768
  const dialogueLine = `Dialogue: 0,${formatAssTime(startTime)},${formatAssTime(endTime)},Title,,0,0,0,,{\\fad(500,500)\\blur0.7\\bord1.5\\1c&H${titleColor1}&\\3c&H000000&\\alpha&H00&\\pos(256,384)\\fs24\\an5\\q2\\i0\\fn@Arial Unicode MS\\shad0\\be0\\b0}{\\blur5\\3c&H000000&\\4c&H000000&\\1a&HB0&\\3a&HC0&\\4a&HC0&\\t(0,100,\\alpha&H60&)\\p1}m -100 -30 b -100 -50 100 -50 100 -30 b 100 -10 -100 -10 -100 -30{\\p0}${titleText}`;

  return dialogueLine;
}

// Hàm xử lý toàn bộ workflow cho 1 task
async function processTask(task) {
  const startTime = Date.now();
  const { id, images, durations, voiceUrl, bgUrl, subtitleUrl, titleText } = task;

  writeLog(`[Task ${id}] Bắt đầu xử lý task với ${images.length} ảnh`, 'INFO');

  // Ghi log task đầu vào
  try {
    fs.writeFileSync(`${logsDir}/task_${id}_input.json`, JSON.stringify(task, null, 2));
    writeLog(`[Task ${id}] Đã ghi log task đầu vào`, 'INFO');
  } catch (error) {
    writeLog(`[Task ${id}] Không thể ghi log task đầu vào: ${error.message}`, 'ERROR');
  }

  // Thiết lập timeout tổng thể cho task
  const TASK_TIMEOUT = 30 * 60 * 1000; // 30 phút
  const taskTimeoutPromise = new Promise((_, reject) => {
    setTimeout(() => {
      reject(new Error(`[Task ${id}] Quá trình xử lý task bị timeout sau ${(TASK_TIMEOUT / 60000)} phút`));
    }, TASK_TIMEOUT);
  });

  try {
    // Chạy task với timeout
    const processPromise = (async () => {
      try {
        // --- Thiết lập thông số chung ---
        const fps = 30;
        const preset = "medium";
        const video_quality = 20;
        const video_width = 512;
        const video_height = 768;
        const largeScale = 3000;
        const bitrate = "3M";
        const gopSize = 15;
        const zoomSpeed = 0.0004;
        const maxZoom = 1.15;

        // --- Bước 1: Tạo thư mục chứa video tạm ---
        const tempDir = `temp_videos_${id}`;
        if (!fs.existsSync(tempDir)) {
          fs.mkdirSync(tempDir, { recursive: true });
          writeLog(`[Task ${id}] Đã tạo thư mục tạm: ${tempDir}`, 'INFO');
        }

        // --- Bước 2: Tạo video cho từng ảnh với hiệu ứng Ken Burns nâng cao ---
        for (let i = 0; i < images.length; i++) {
          const image = images[i];
          let duration = parseFloat(durations[i]);

          // Kéo dài thời gian hiển thị của ảnh cuối cùng thêm 2 giây
          if (i === images.length - 1) {
            duration = duration + 2;
            writeLog(`[Task ${id}] Kéo dài thời gian hiển thị của ảnh cuối cùng thêm 2 giây: ${duration}s`, 'INFO');
          }

          const index = i + 1;
          const frames = Math.round(fps * duration);

          // Tải ảnh về local trước khi xử lý
          const localImagePath = `${tempDir}/image_${index}.png`;
          try {
            await downloadFile(image, localImagePath);
            writeLog(`[Task ${id}] Đã tải ảnh ${index} vào ${localImagePath}`, 'INFO');
          } catch (error) {
            writeLog(`[Task ${id}] Lỗi khi tải ảnh ${index}: ${error.message}`, 'ERROR');
            throw error;
          }

          // Tạo hiệu ứng Ken Burns hiện đại hơn cho mỗi ảnh
          let zoompan_filter;
          switch (index % 4) { // Giảm số lượng hiệu ứng xuống một nửa - chỉ dùng 4 kiểu tinh tế
            case 0:
              // Zoom nhẹ vào trung tâm - hiệu ứng tinh tế nhất
              zoompan_filter = `scale=${largeScale}:-1,zoompan=z='min(1+(on/${frames})*0.1,1.1)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${video_width}x${video_height}:fps=${fps}`;
              break;
            case 1:
              // Pan từ trái sang phải nhẹ nhàng với zoom cố định
              zoompan_filter = `scale=${largeScale}:-1,zoompan=z='1.05':x='max(0,min((iw-iw/zoom)*((on)/${frames}),iw))':y='ih/2-(ih/zoom/2)':d=${frames}:s=${video_width}x${video_height}:fps=${fps}`;
              break;
            case 2:
              // Pan từ trên xuống dưới nhẹ nhàng
              zoompan_filter = `scale=${largeScale}:-1,zoompan=z='1.05':x='iw/2-(iw/zoom/2)':y='max(0,min((ih-ih/zoom)*((on)/${frames}),ih))':d=${frames}:s=${video_width}x${video_height}:fps=${fps}`;
              break;
            case 3:
              // Zoom out nhẹ - tạo cảm giác thư giãn
              zoompan_filter = `scale=${largeScale}:-1,zoompan=z='max(1.1-(on/${frames})*0.08,1.02)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${video_width}x${video_height}:fps=${fps}`;
              break;
          }

          const filter_complex = [
            zoompan_filter,
            'setsar=1',
            'format=yuv420p'
          ].join(',');

          const args = [
            "-y", "-threads", "0",
            "-loop", "1", "-i", localImagePath,
            "-t", duration.toString(),
            "-vf", filter_complex,
            "-c:v", "libx264",
            "-pix_fmt", "yuv420p",
            "-preset", preset,
            "-crf", video_quality.toString(),
            "-r", fps.toString(),
            "-g", gopSize.toString(),
            "-keyint_min", gopSize.toString(),
            "-sc_threshold", "0",
            "-b:v", bitrate,
            "-movflags", "+faststart",
            `${tempDir}/${index}.mp4`
          ];

          try {
            console.log(`[Task ${id}] Xử lý ảnh ${index}: ${image}`);
            writeLog(`[Task ${id}] Bắt đầu xử lý ảnh ${index} với lệnh: ${args.join(' ')}`, 'INFO');
            await runFFmpeg(args);
            
            // Kiểm tra thời lượng video đã tạo
            const probeArgs = [
              "-v", "error",
              "-show_entries", "format=duration",
              "-of", "default=noprint_wrappers=1:nokey=1",
              `${tempDir}/${index}.mp4`
            ];
            
            const probeResult = await runFFprobe(probeArgs);
            const actualDuration = parseFloat(probeResult.stdout.trim());
            
            // Kiểm tra nếu thời lượng thực tế khác nhiều so với dự kiến
            if (Math.abs(actualDuration - duration) > 0.1) {
              writeLog(`[Task ${id}] Cảnh báo: Thời lượng video ảnh ${index} (${actualDuration}s) khác so với dự kiến (${duration}s)`, 'WARNING');
            }
            
            console.log(`[Task ${id}] Đã xử lý xong ảnh ${index}`);
          } catch (error) {
            console.error(`[Task ${id}] Lỗi khi xử lý ảnh ${index}:`, error);
            writeLog(`[Task ${id}] Lỗi chi tiết khi xử lý ảnh ${index}: ${JSON.stringify(error)}`, 'ERROR');
            throw new Error(`Lỗi khi xử lý ảnh ${index}: ${error.message || 'Lỗi không xác định'}`);
          }
        }

        // --- Bước 3: Nối video và thêm hiệu ứng chuyển cảnh (phương pháp đơn giản hơn) ---
        const temp_video_no_audio = `temp_video_no_audio_${id}.mp4`;

        try {
          // Sử dụng phương pháp xfade để có hiệu ứng chuyển cảnh đẹp hơn
          writeLog(`[Task ${id}] Bắt đầu nối video với hiệu ứng xfade`, 'INFO');

          try {
            // Danh sách các hiệu ứng chuyển cảnh
            const transitions = [
              'distance'
            ];

            // Kiểm tra số lượng ảnh và thời lượng
            if (images.length !== durations.length) {
              writeLog(`[Task ${id}] Cảnh báo: Số lượng ảnh (${images.length}) khác với số lượng thời lượng (${durations.length})`, 'WARNING');
              // Đảm bảo chỉ xử lý số lượng ảnh tương ứng với số lượng thời lượng có sẵn
              if (images.length > durations.length) {
                writeLog(`[Task ${id}] Chỉ xử lý ${durations.length} ảnh đầu tiên`, 'WARNING');
              }
            }

            // Xác định số lượng video cần xử lý
            const videoCount = Math.min(images.length, durations.length);

            // Tạo danh sách tất cả các video để ghép
            const videoList = [];
            for (let i = 0; i < videoCount; i++) {
              videoList.push(`${tempDir}/${i + 1}.mp4`);
            }
            
            // Sử dụng concat filter thay vì concat demuxer
            let filterComplex = '';
            
            // Tạo input cho mỗi video
            const concatArgs = ["-y", "-threads", "0"];
            for (const videoPath of videoList) {
              concatArgs.push("-i", videoPath);
            }
            
            // Tạo filter complex để ghép video
            for (let i = 0; i < videoList.length; i++) {
              filterComplex += `[${i}:v]`;
            }
            filterComplex += `concat=n=${videoList.length}:v=1:a=0[outv]`;
            
            // Thêm filter complex và output
            concatArgs.push(
              "-filter_complex", filterComplex,
              "-map", "[outv]",
              "-c:v", "libx264",
              "-pix_fmt", "yuv420p",
              "-preset", preset,
              "-crf", video_quality.toString(),
              "-r", fps.toString(),
              temp_video_no_audio
            );
            
            writeLog(`[Task ${id}] Bắt đầu ghép ${videoList.length} video với concat filter`, 'INFO');
            await runFFmpeg(concatArgs);
            
            // Kiểm tra thời lượng video cuối cùng
            const finalProbeArgs = [
              "-v", "error",
              "-show_entries", "format=duration",
              "-of", "default=noprint_wrappers=1:nokey=1",
              temp_video_no_audio
            ];
            
            const finalProbeResult = await runFFprobe(finalProbeArgs);
            const finalDuration = parseFloat(finalProbeResult.stdout.trim());
            
            // Tính tổng thời lượng dự kiến
            let expectedTotalDuration = 0;
            for (let i = 0; i < durations.length; i++) {
              expectedTotalDuration += parseFloat(durations[i]);
            }
            // Cộng thêm 2 giây cho ảnh cuối
            expectedTotalDuration += 2;
            
            writeLog(`[Task ${id}] Video cuối cùng: Thời lượng thực tế=${finalDuration}s (Dự kiến: ${expectedTotalDuration}s)`, 'INFO');
            
            // Kiểm tra nếu thời lượng thực tế khác nhiều so với dự kiến
            if (Math.abs(finalDuration - expectedTotalDuration) > 1) {
              writeLog(`[Task ${id}] Cảnh báo: Thời lượng video cuối cùng (${finalDuration}s) khác nhiều so với dự kiến (${expectedTotalDuration}s)`, 'WARNING');
              
              // Nếu thời lượng quá ngắn, có thể thử phương pháp khác
              if (finalDuration < expectedTotalDuration * 0.8) {
                writeLog(`[Task ${id}] Thời lượng quá ngắn, thử phương pháp ghép video khác`, 'WARNING');
                
                // Phương pháp sử dụng xfade với từng cặp video
                // Lưu ý: Phương pháp này có hiệu ứng chuyển cảnh nhưng có thể không giữ đúng thời lượng
                
                // Xử lý từng cặp video để tránh filter complex quá phức tạp
                let currentOutput = `${tempDir}/xfade_temp_0.mp4`;
                fs.copyFileSync(`${tempDir}/1.mp4`, currentOutput);
                
                // Thời lượng chuyển cảnh (giây)
                const transitionDuration = 0.3;
                
                for (let i = 1; i < videoCount; i++) {
                  const nextVideo = `${tempDir}/${i + 1}.mp4`;
                  const outputVideo = `${tempDir}/xfade_temp_${i}.mp4`;
                  const transition = 'distance';
                  
                  // Lấy thông tin thời lượng video hiện tại
                  const probeArgs = [
                    "-v", "error",
                    "-show_entries", "format=duration",
                    "-of", "default=noprint_wrappers=1:nokey=1",
                    currentOutput
                  ];
                  
                  const probeResult = await runFFprobe(probeArgs);
                  const duration = parseFloat(probeResult.stdout.trim());
                  
                  // Lấy thông tin thời lượng video tiếp theo
                  const nextProbeArgs = [
                    "-v", "error",
                    "-show_entries", "format=duration",
                    "-of", "default=noprint_wrappers=1:nokey=1",
                    nextVideo
                  ];
                  
                  const nextProbeResult = await runFFprobe(nextProbeArgs);
                  const nextDuration = parseFloat(nextProbeResult.stdout.trim());
                  
                  // Tính offset (thời điểm bắt đầu hiệu ứng chuyển cảnh)
                  // Đảm bảo offset không vượt quá thời lượng video
                  // Sử dụng thời lượng dự kiến thay vì thời lượng thực tế
                  const expectedDuration = parseFloat(durations[i-1]);
                  const offset = Math.max(0.5, Math.min(expectedDuration - transitionDuration, expectedDuration * 0.9));
                  
                  writeLog(`[Task ${id}] Áp dụng hiệu ứng ${transition} giữa video ${i} và ${i+1} với thời lượng ${transitionDuration}s tại offset ${offset}s`, 'INFO');
                  
                  // Tạo lệnh xfade với setpts để đảm bảo thời lượng
                  const xfadeArgs = [
                    "-y", "-threads", "0",
                    "-i", currentOutput,
                    "-i", nextVideo,
                    "-filter_complex", `xfade=transition=${transition}:duration=${transitionDuration}:offset=${offset}`,
                    "-c:v", "libx264",
                    "-pix_fmt", "yuv420p",
                    "-preset", preset,
                    "-crf", video_quality.toString(),
                    "-r", fps.toString(),
                    outputVideo
                  ];
                  
                  await runFFmpeg(xfadeArgs);
                  
                  // Cập nhật currentOutput cho vòng lặp tiếp theo
                  if (i > 1) {
                    // Xóa file tạm thời trước đó để tiết kiệm dung lượng
                    fs.unlinkSync(currentOutput);
                  }
                  currentOutput = outputVideo;
                }
                
                // Đổi tên file cuối cùng thành output
                fs.copyFileSync(currentOutput, `${tempDir}/xfade_final.mp4`);
                
                // Kiểm tra thời lượng video cuối cùng
                const xfadeFinalProbeArgs = [
                  "-v", "error",
                  "-show_entries", "format=duration",
                  "-of", "default=noprint_wrappers=1:nokey=1",
                  `${tempDir}/xfade_final.mp4`
                ];
                
                const xfadeFinalProbeResult = await runFFprobe(xfadeFinalProbeArgs);
                const xfadeFinalDuration = parseFloat(xfadeFinalProbeResult.stdout.trim());
                
                writeLog(`[Task ${id}] Video xfade cuối cùng: Thời lượng thực tế=${xfadeFinalDuration}s (Dự kiến: ${expectedTotalDuration}s)`, 'INFO');
                
                // Nếu thời lượng xfade tốt hơn, sử dụng nó
                if (Math.abs(xfadeFinalDuration - expectedTotalDuration) < Math.abs(finalDuration - expectedTotalDuration)) {
                  writeLog(`[Task ${id}] Sử dụng video xfade vì thời lượng tốt hơn`, 'INFO');
                  fs.copyFileSync(`${tempDir}/xfade_final.mp4`, temp_video_no_audio);
                }
              }
            }
            
            writeLog(`[Task ${id}] Nối video thành công: ${temp_video_no_audio}`, 'INFO');

            // Xóa các file tạm
            for (let i = 0; i < videoCount - 1; i++) {
              const tempFile = `${tempDir}/temp_${i}.mp4`;
              if (fs.existsSync(tempFile)) {
                fs.unlinkSync(tempFile);
              }
            }
          } catch (error) {
            writeLog(`[Task ${id}] Lỗi khi nối video: ${error.message}`, 'ERROR');
            throw new Error(`Lỗi khi nối video: ${error.message}`);
          }

        } catch (error) {
          throw new Error(`Lỗi khi nối video: ${error.message}`);
        }

        // --- Bước 4: Tải và xử lý file âm thanh ---
        const voice_file = `voice_${id}.mp3`;
        const bg_file = `bg_${id}.mp3`;

        // Tải file voice và background
        await Promise.all([
          downloadFile(voiceUrl, voice_file),
          downloadFile(bgUrl, bg_file)
        ]);

        // --- Bước 5: Mix âm thanh ---
        const temp_audio = `temp_audio_${id}.mp3`;
        const audioArgs = [
          "-y", "-threads", "0",
          "-i", voice_file,
          "-i", bg_file,
          "-filter_complex",
          `[0:a]volume=1[voice];[1:a]volume=0.2[bg];[voice][bg]amix=inputs=2:duration=first:dropout_transition=2,dynaudnorm=f=200[out]`,
          "-map", "[out]",
          temp_audio
        ];

        await runFFmpeg(audioArgs);

        // Ghi log cho quá trình xử lý âm thanh
        writeLog(`[Task ${id}] Đã mix âm thanh thành công`, 'INFO');

        // --- Bước 6: Tạo subtitle ASS ---
        if (subtitleUrl) {
          try {
            // Đảm bảo URL phải là file ASS
            if (!subtitleUrl.toLowerCase().endsWith('.ass')) {
              throw new Error("Chỉ hỗ trợ file ASS cho subtitleUrl");
            }
            
            // Tải file ASS về
            const subtitle_ass = `subtitle_${id}.ass`;
            await downloadFile(subtitleUrl, subtitle_ass);
            
            // Xử lý trực tiếp file ASS và thêm tiêu đề
            const result = await processAssSubtitle(subtitle_ass, task);
            
            if (!result) {
              throw new Error("Không thể xử lý file ASS");
            }
            
            writeLog(`[Task ${id}] Đã xử lý file ASS thành công`, 'INFO');

            // --- Bước 7: Kết hợp video, audio và subtitle ---
            const output_file = `output_${id}.mp4`;
            const finalArgs = [
              "-y", "-threads", "0",
              "-i", temp_video_no_audio,
              "-i", temp_audio,
              "-i", subtitle_ass,
              "-map", "0:v",
              "-map", "1:a",
              "-c:v", "libx264",
              "-c:a", "aac",
              "-vf", `ass=${subtitle_ass}`,
              "-metadata:s:v", `title="Video with burned subtitles"`,
              output_file
            ];

            await runFFmpeg(finalArgs);

            // Ghi log cho quá trình xử lý subtitle
            writeLog(`[Task ${id}] Đã thêm subtitle ASS thành công`, 'INFO');

            // Xóa các file tạm
            fs.unlinkSync(subtitle_ass);
          } catch (error) {
            writeLog(`[Task ${id}] Lỗi khi xử lý subtitle: ${error.message}`, 'ERROR');

            // Nếu có lỗi khi xử lý subtitle, tạo video không có subtitle
            const output_file = `output_${id}.mp4`;
            const finalArgs = [
              "-y", "-threads", "0",
              "-i", temp_video_no_audio,
              "-i", temp_audio,
              "-map", "0:v",
              "-map", "1:a",
              "-c:v", "libx264",
              "-c:a", "aac",
              output_file
            ];

            await runFFmpeg(finalArgs);
            writeLog(`[Task ${id}] Đã tạo video không có subtitle do lỗi xử lý subtitle`, 'INFO');
          }
        } else {
          // Nếu không có subtitle, chỉ kết hợp video và audio
          const output_file = `output_${id}.mp4`;
          const finalArgs = [
            "-y", "-threads", "0",
            "-i", temp_video_no_audio,
            "-i", temp_audio,
            "-map", "0:v",
            "-map", "1:a",
            "-c:v", "libx264",
            "-c:a", "aac",
            output_file
          ];

          await runFFmpeg(finalArgs);
          writeLog(`[Task ${id}] Đã tạo video không có subtitle thành công`, 'INFO');
        }

        // Xóa các file tạm nhưng giữ lại log
        try {
          if (fs.existsSync(voice_file)) fs.unlinkSync(voice_file);
          if (fs.existsSync(bg_file)) fs.unlinkSync(bg_file);
          if (fs.existsSync(temp_audio)) fs.unlinkSync(temp_audio);
          if (fs.existsSync(temp_video_no_audio)) fs.unlinkSync(temp_video_no_audio);

          // Xóa thư mục tạm và các file trong đó
          /* Comment lại để kiểm tra output
          if (fs.existsSync(tempDir)) {
            const files = fs.readdirSync(tempDir);
            for (const file of files) {
              fs.unlinkSync(path.join(tempDir, file));
            }
            fs.rmdirSync(tempDir);
          }
          */

          writeLog(`[Task ${id}] Đã giữ lại thư mục tạm để kiểm tra: ${tempDir}`, 'INFO');
        } catch (error) {
          writeLog(`[Task ${id}] Lỗi khi xóa file tạm: ${error.message}`, 'WARNING');
        }

        // Ghi log tổng kết
        const duration = (Date.now() - startTime) / 1000;
        const summary = {
          taskId: id,
          startTime: new Date(startTime).toISOString(),
          endTime: new Date().toISOString(),
          duration: duration,
          totalImages: images.length,
          totalDuration: durations.reduce((acc, d) => acc + parseFloat(d), 0),
          hasSubtitle: !!subtitleUrl,
          videoSettings: {
            width: video_width,
            height: video_height,
            fps: fps,
            quality: video_quality,
            preset: preset
          }
        };

        fs.writeFileSync(
          `${logsDir}/task_${id}_summary.json`,
          JSON.stringify(summary, null, 2)
        );

        writeLog(`[Task ${id}] Hoàn thành xử lý task sau ${duration}s`, 'INFO');
        return { success: true, duration, summary };

      } catch (error) {
        const errorMessage = error.message || 'Lỗi không xác định';
        throw new Error(`Lỗi trong quá trình xử lý task: ${errorMessage}`);
      }
    })();

    // Chạy task với timeout
    return await Promise.race([processPromise, taskTimeoutPromise]);

  } catch (error) {
    const duration = (Date.now() - startTime) / 1000;
    writeLog(`[Task ${id}] Lỗi sau ${duration}s: ${error.message}`, 'ERROR');
    throw error;
  }
}

// Hàm tải file từ URL
async function downloadFile(url, filename) {
  try {
    writeLog(`Đang tải file từ ${url} vào ${filename}`, 'INFO');

    // Check if the URL is a local file path
    if (url.startsWith('mock/') || url.startsWith('./') || url.startsWith('../') || /^[a-zA-Z]:\\/.test(url) || url.startsWith('/')) {
      // For local files, just copy the file
      fs.copyFileSync(url, filename);
      writeLog(`Đã copy xong file local ${filename}`, 'INFO');
      return;
    }

    // For remote URLs, use fetch
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Không thể tải file từ ${url}: ${response.status} ${response.statusText}`);
    }

    const buffer = await response.buffer();
    fs.writeFileSync(filename, buffer);
    writeLog(`Đã tải xong file ${filename}`, 'INFO');
  } catch (error) {
    writeLog(`Lỗi khi tải file từ ${url}: ${error.message}`, 'ERROR');
    throw error;
  }
}

// Endpoint mới: nhận 1 task và xử lý workflow cho task đó
app.post('/process', async (req, res) => {
  const task = req.body; // Dữ liệu của task được gửi trực tiếp ({{ $json.xx }})
  if (!task || !task.id) {
    return res.status(400).send({ error: 'Task data is required with at least an id field' });
  }
  try {
    // Sử dụng writeLog thay vì console.log để tránh ghi log trùng lặp
    writeLog(`Processing task with id: ${task.id}`, 'INFO');
    const result = await processTask(task);

    // Tạo URL để tải video
    const host = req.get('host');
    const protocol = req.protocol;
    const outputFile = `output_${task.id}.mp4`;
    const downloadUrl = `${protocol}://${host}/download/${outputFile}`;

    res.send({
      id: task.id,
      outputFile,
      downloadUrl,
      status: 'success',
      message: 'Video đã được xử lý thành công',
      result
    });
  } catch (error) {
    console.error("Error processing task:", error);
    res.status(500).send({
      error: error.message,
      id: task.id,
      status: 'error',
      message: 'Có lỗi xảy ra khi xử lý video'
    });
  }
});

// Endpoint mới: tải video
app.get('/download/:filename', (req, res) => {
  const filename = req.params.filename;

  // Kiểm tra tên file để tránh path traversal
  if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    return res.status(400).send({ error: 'Invalid filename' });
  }

  // Kiểm tra file tồn tại
  if (!fs.existsSync(filename)) {
    return res.status(404).send({ error: 'File not found' });
  }

  // Lấy thông tin file
  const stats = fs.statSync(filename);
  const fileSize = stats.size;

  // Thiết lập headers
  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader('Content-Length', fileSize);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

  // Tạo stream để gửi file
  const fileStream = fs.createReadStream(filename);
  fileStream.pipe(res);

  // Xử lý lỗi stream
  fileStream.on('error', (error) => {
    console.error(`Error streaming file ${filename}:`, error);
    if (!res.headersSent) {
      res.status(500).send({ error: 'Error streaming file' });
    } else {
      res.end();
    }
  });

  // Sử dụng writeLog thay vì console.log để tránh ghi log trùng lặp
  writeLog(`Streaming file: ${filename}, size: ${fileSize} bytes`, 'INFO');
});

// Endpoint mới: lấy danh sách video đã xử lý
app.get('/videos', (req, res) => {
  try {
    // Kiểm tra xem thư mục logs có tồn tại không
    if (!fs.existsSync(logsDir)) {
      return res.status(404).send({ error: 'Thư mục logs không tồn tại' });
    }

    // Lấy danh sách các file log
    const files = fs.readdirSync(logsDir);
    const logFiles = files.filter(file => file.endsWith('.log') || file.endsWith('.json'));

    // Tạo danh sách logs với URL để xem
    const host = req.get('host');
    const protocol = req.protocol;
    const logs = logFiles.map(file => {
      const stats = fs.statSync(path.join(logsDir, file));
      return {
        filename: file,
        size: stats.size,
        created: stats.mtime,
        viewUrl: `${protocol}://${host}/logs/${file}`
      };
    });

    res.send({ logs });
  } catch (error) {
    console.error('Error getting logs list:', error);
    res.status(500).send({ error: error.message });
  }
});

// Endpoint để xem logs
app.get('/logs', (req, res) => {
  try {
    // Kiểm tra xem thư mục logs có tồn tại không
    if (!fs.existsSync(logsDir)) {
      return res.status(404).send({ error: 'Thư mục logs không tồn tại' });
    }

    // Lấy danh sách các file log
    const files = fs.readdirSync(logsDir);
    const logFiles = files.filter(file => file.endsWith('.log') || file.endsWith('.json'));

    // Tạo danh sách logs với URL để xem
    const host = req.get('host');
    const protocol = req.protocol;
    const logs = logFiles.map(file => {
      const stats = fs.statSync(path.join(logsDir, file));
      return {
        filename: file,
        size: stats.size,
        created: stats.mtime,
        viewUrl: `${protocol}://${host}/logs/${file}`
      };
    });

    res.send({ logs });
  } catch (error) {
    console.error('Error getting logs list:', error);
    res.status(500).send({ error: error.message });
  }
});

// Endpoint để xem nội dung của một file log cụ thể
app.get('/logs/:filename', (req, res) => {
  try {
    const filename = req.params.filename;
    const filePath = path.join(logsDir, filename);

    // Kiểm tra xem file có tồn tại không
    if (!fs.existsSync(filePath)) {
      return res.status(404).send({ error: 'File log không tồn tại' });
    }

    // Kiểm tra xem file có phải là file log hợp lệ không
    if (!filename.endsWith('.log') && !filename.endsWith('.json')) {
      return res.status(400).send({ error: 'Chỉ hỗ trợ xem file .log và .json' });
    }

    // Đọc nội dung file
    const content = fs.readFileSync(filePath, 'utf8');

    // Trả về nội dung dựa trên loại file
    if (filename.endsWith('.json')) {
      res.setHeader('Content-Type', 'application/json');
      res.send(content);
    } else {
      // Nếu là file log, trả về dạng text
      res.setHeader('Content-Type', 'text/plain');
      res.send(content);
    }
  } catch (error) {
    console.error(`Error reading log file: ${error.message}`);
    res.status(500).send({ error: error.message });
  }
});

// Endpoint để xóa một file log cụ thể
app.delete('/logs/:filename', (req, res) => {
  try {
    const filename = req.params.filename;
    const filePath = path.join(logsDir, filename);

    // Kiểm tra xem file có tồn tại không
    if (!fs.existsSync(filePath)) {
      return res.status(404).send({ error: 'File log không tồn tại' });
    }

    // Kiểm tra xem file có phải là file log hợp lệ không
    if (!filename.endsWith('.log') && !filename.endsWith('.json')) {
      return res.status(400).send({ error: 'Chỉ hỗ trợ xóa file .log và .json' });
    }

    // Xóa file
    fs.unlinkSync(filePath);
    writeLog(`Đã xóa file log: ${filename}`, 'INFO');

    res.send({ success: true, message: `Đã xóa file log: ${filename}` });
  } catch (error) {
    console.error(`Error deleting log file: ${error.message}`);
    res.status(500).send({ error: error.message });
  }
});

app.listen(3000, () => {
  writeLog('Improved HTTP wrapper listening on port 3000', 'INFO');
});

// Hàm trực tiếp xử lý file ASS và thêm tiêu đề
async function processAssSubtitle(assFilePath, task) {
  writeLog(`Bắt đầu xử lý và thêm tiêu đề vào file ASS: ${assFilePath}`, 'INFO');

  try {
    // Kiểm tra file ASS có tồn tại không
    if (!fs.existsSync(assFilePath)) {
      writeLog(`File ${assFilePath} không tồn tại.`, 'ERROR');
      return false;
    }

    // Đọc nội dung file ASS
    const assContent = fs.readFileSync(assFilePath, 'utf8');
    
    // Tách phần header và dialogue
    const headerEndIndex = assContent.indexOf('[Events]');
    if (headerEndIndex === -1) {
      writeLog(`File ASS không hợp lệ: không tìm thấy phần [Events]`, 'ERROR');
      return false;
    }
    
    // Lấy phần header bao gồm cả [Events] và Format line
    let headerPart = assContent.substring(0, headerEndIndex);
    const formatLineStart = assContent.indexOf('Format:', headerEndIndex);
    const dialogueStart = assContent.indexOf('Dialogue:', formatLineStart);
    
    if (formatLineStart === -1 || dialogueStart === -1) {
      writeLog(`File ASS không hợp lệ: không tìm thấy Format hoặc Dialogue`, 'ERROR');
      return false;
    }
    
    headerPart = assContent.substring(0, dialogueStart);
    const dialoguePart = assContent.substring(dialogueStart);
    
    // Thiết lập thông tin tiêu đề
    const titleText = task && task.titleText ? task.titleText : "";
    const titleColor1 = task && task.titleColor1 ? task.titleColor1 : "FFFFFF"; // Màu chữ (trắng tinh khiết)
    const titleColor2 = task && task.titleColor2 ? task.titleColor2 : "FFFFFF"; // Không dùng gradient
    const titleDuration = task && task.titleDuration ? task.titleDuration : 3; // Thời gian hiển thị title (giây)
    
    // Log thông tin tiêu đề
    if (titleText && titleText.trim() !== "") {
      writeLog(`Sử dụng tiêu đề: "${titleText}"`, 'INFO');
    } else {
      writeLog(`Không sử dụng tiêu đề`, 'INFO');
    }
    
    // Tạo nội dung mới cho file ASS
    let newAssContent = headerPart;
    
    // Thêm dòng tiêu đề nếu cần
    if (titleText && titleText.trim() !== "") {
      const titleLine = createTitleLine({
        titleText,
        titleColor1,
        titleColor2,
        titleDuration
      });
      
      if (titleLine !== "") {
        // Thêm tiêu đề vào trước các dialogue hiện có
        newAssContent += titleLine + "\n";
      }
    }
    
    // Thêm phần dialogue gốc
    newAssContent += dialoguePart;
    
    // Ghi đè file ASS
    fs.writeFileSync(assFilePath, newAssContent, 'utf8');
    writeLog(`Đã xử lý thành công file phụ đề ASS: ${assFilePath}`, 'INFO');
    
    return true;
  } catch (error) {
    writeLog(`Lỗi khi xử lý file ASS: ${error.message}`, 'ERROR');
    return false;
  }
}
