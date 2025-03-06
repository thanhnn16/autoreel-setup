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
  fs.mkdirSync(logsDir, { recursive: true });
}

// Tạo file log cho server
const serverLogFile = path.join(logsDir, 'server.log');

// Hàm ghi log
function writeLog(message, level = 'INFO') {
  const timestamp = new Date().toISOString();
  const formattedMessage = `[${timestamp}] [${level}] ${message}\n`;
  
  // Vẫn giữ console log hiện tại
  if (level === 'ERROR') {
    console.error(message);
  } else {
    console.log(message);
  }
  
  // Ghi vào file log
  fs.appendFileSync(serverLogFile, formattedMessage);
}

// Override console.log và console.error để ghi logs
const originalConsoleLog = console.log;
const originalConsoleError = console.error;

console.log = function() {
  const message = format.apply(null, arguments);
  originalConsoleLog.apply(console, arguments);
  fs.appendFileSync(serverLogFile, `[${new Date().toISOString()}] [INFO] ${message}\n`);
};

console.error = function() {
  const message = format.apply(null, arguments);
  originalConsoleError.apply(console, arguments);
  fs.appendFileSync(serverLogFile, `[${new Date().toISOString()}] [ERROR] ${message}\n`);
};

// Hàm chạy ffmpeg và trả về Promise
function runFFmpeg(args) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    writeLog(`[FFmpeg] Bắt đầu thực thi lệnh: ffmpeg ${args.join(' ')}`, 'INFO');
    
    const ffmpeg = spawn('ffmpeg', args);
    let stdout = '';
    let stderr = '';

    ffmpeg.stdout.on('data', (data) => { 
      const chunk = data.toString();
      stdout += chunk; 
      // Có thể log ra từng phần output nếu cần
      // writeLog(`[FFmpeg] stdout: ${chunk}`, 'INFO');
    });
    
    ffmpeg.stderr.on('data', (data) => { 
      const chunk = data.toString();
      stderr += chunk; 
      // FFmpeg thường ghi log vào stderr, kể cả khi không có lỗi
      // Chỉ log ra các thông báo lỗi quan trọng
      if (chunk.includes('Error') || chunk.includes('error') || chunk.includes('failed')) {
        writeLog(`[FFmpeg] stderr: ${chunk}`, 'ERROR');
      }
    });

    ffmpeg.on('error', (error) => {
      const duration = (Date.now() - startTime) / 1000;
      writeLog(`[FFmpeg] Lỗi khi khởi chạy process (${duration}s): ${error.message}`, 'ERROR');
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
        writeLog(`[FFmpeg] Thực thi thành công (${duration}s)`, 'INFO');
        resolve({ 
          code, 
          stdout, 
          stderr,
          duration,
          command: `ffmpeg ${args.join(' ')}`
        });
      } else {
        writeLog(`[FFmpeg] Thực thi thất bại với mã lỗi ${code} (${duration}s)`, 'ERROR');
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

// Hàm xử lý toàn bộ workflow cho 1 task
async function processTask(task) {
  const startTime = Date.now();
  const { id, images, durations, voiceUrl, bgUrl, subtitleUrl } = task;
  
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
      reject(new Error(`[Task ${id}] Quá trình xử lý task bị timeout sau ${TASK_TIMEOUT/60000} phút`));
    }, TASK_TIMEOUT);
  });
  
  try {
    // Chạy task với timeout
    const processPromise = (async () => {
      try {
        // --- Thiết lập thông số chung ---
        const fps = 60;
        const preset = "veryfast";
        const video_quality = 22;
        const pan_range = 30;
        const video_width = 720;
        const video_height = 1280;
        
        // --- Bước 1: Tạo file danh sách ảnh ---
        const imagesListFilename = `images_${id}.txt`;
        let imagesListContent = '';
        for (let i = 0; i < images.length; i++) {
          imagesListContent += `file '${images[i]}'\n`;
          imagesListContent += `duration ${durations[i]}\n`;
        }
        imagesListContent += `file '${images[images.length - 1]}'\n`;
        fs.writeFileSync(imagesListFilename, imagesListContent);

        // Tính tổng thời gian video (giả sử durations là số giây dạng chuỗi)
        const total_duration = durations.reduce((acc, d) => acc + parseFloat(d), 0);
        console.log(`[Task ${id}] Tổng thời gian video: ${total_duration} giây`);

        // --- Bước 2: Tạo thư mục chứa video tạm ---
        const tempDir = `temp_videos_${id}`;
        if (!fs.existsSync(tempDir)) {
          fs.mkdirSync(tempDir);
        }

        // --- Bước 3: Chuyển từng ảnh thành file video với hiệu ứng zoompan ---
        for (let i = 0; i < images.length; i++) {
          const image = images[i];
          const duration = durations[i];
          const index = i + 1;

          // Tính biểu thức y theo chỉ số ảnh (ảnh lẻ: pan xuống, ảnh chẵn: pan lên)
          let y_expr;
          if (index % 2 === 0) {
            y_expr = `${pan_range} - (${pan_range}*on/((${fps}*${duration})-1))`;
          } else {
            y_expr = `(${pan_range}*on/((${fps}*${duration})-1))`;
          }

          const args = [
            "-y", "-threads", "0",
            "-loop", "1", "-i", image,
            "-t", duration,
            "-vf", `scale=${video_width}:${video_height}:force_original_aspect_ratio=increase,crop=${video_width}:${video_height},zoompan=z='1.1':d=${fps}*${duration}:x='iw/2-(iw/1.1)/2':y=${y_expr}:s=${video_width}x${video_height}:fps=${fps}`,
            "-c:v", "libx264",
            "-pix_fmt", "yuv420p",
            "-preset", preset,
            "-crf", video_quality.toString(),
            `${tempDir}/${index}.mp4`
          ];
          console.log(`[Task ${id}] Xử lý ảnh ${index}: ${image}`);
          await runFFmpeg(args);
        }

        // --- Bước 4: Tạo file danh sách các video tạm ---
        const listFile = `list_${id}.txt`;
        let listContent = '';
        for (let i = 1; i <= images.length; i++) {
          listContent += `file '${tempDir}/${i}.mp4'\n`;
        }
        fs.writeFileSync(listFile, listContent);

        // --- Bước 5: Nối các video lại với nhau và thêm hiệu ứng fade ---
        const temp_video_no_audio = `temp_video_no_audio_${id}.mp4`;
        const fade_out_start = total_duration - 1;
        const argsConcat = [
          "-y", "-threads", "0",
          "-f", "concat",
          "-safe", "0",
          "-i", listFile,
          "-filter_complex", `fps=${fps},format=yuv420p,fade=t=in:st=0:d=0.5,fade=t=out:st=${fade_out_start}:d=0.5`,
          "-c:v", "libx264",
          "-pix_fmt", "yuv420p",
          "-preset", preset,
          "-crf", video_quality.toString(),
          temp_video_no_audio
        ];
        
        try {
          console.log(`[Task ${id}] Bắt đầu nối các video và thêm hiệu ứng fade`);
          console.log(`[Task ${id}] Tham số FFmpeg: ${JSON.stringify(argsConcat)}`);
          
          const concatResult = await runFFmpeg(argsConcat);
          console.log(`[Task ${id}] Nối video thành công: ${temp_video_no_audio}`);
          
          // Ghi log thông tin về quá trình xử lý
          if (concatResult && concatResult.stderr) {
            fs.writeFileSync(`${logsDir}/concat_log_${id}.txt`, concatResult.stderr);
          }
        } catch (error) {
          console.error(`[Task ${id}] Lỗi khi nối video: ${error.message || 'Unknown error'}`);
          if (error.stderr) {
            console.error(`[Task ${id}] Chi tiết lỗi FFmpeg: ${error.stderr}`);
            fs.writeFileSync(`${logsDir}/concat_error_${id}.txt`, error.stderr);
          }
          
          // Kiểm tra xem file đầu ra có tồn tại không
          if (!fs.existsSync(temp_video_no_audio)) {
            throw new Error(`Không thể tạo file video ${temp_video_no_audio}: ${error.message || 'Unknown error'}`);
          }
        }

        // --- Bước 6: Kết hợp video với âm thanh ---
        const temp_video_with_audio = `temp_video_with_audio_${id}.mp4`;
        const argsCombine = [
          "-y", "-threads", "0",
          "-i", temp_video_no_audio,
          "-accurate_seek",
          "-i", voiceUrl,
          "-accurate_seek",
          "-i", bgUrl,
          "-filter_complex", "[1:a]volume=1.0[voice];[2:a]volume=0.3[bg];[voice][bg]amix=inputs=2:duration=longest,dynaudnorm=f=150:g=15[a]",
          "-map", "0:v",
          "-map", "[a]",
          "-c:v", "copy",
          "-c:a", "aac",
          "-b:a", "192k",
          "-shortest",
          temp_video_with_audio
        ];
        
        try {
          console.log(`[Task ${id}] Bắt đầu kết hợp video với âm thanh`);
          console.log(`[Task ${id}] File video đầu vào: ${temp_video_no_audio}`);
          console.log(`[Task ${id}] File âm thanh chính: ${voiceUrl}`);
          console.log(`[Task ${id}] File nhạc nền: ${bgUrl}`);
          console.log(`[Task ${id}] Tham số FFmpeg: ${JSON.stringify(argsCombine)}`);
          
          // Kiểm tra các file đầu vào tồn tại
          if (!fs.existsSync(temp_video_no_audio)) {
            throw new Error(`File video đầu vào không tồn tại: ${temp_video_no_audio}`);
          }
          
          const combineResult = await runFFmpeg(argsCombine);
          console.log(`[Task ${id}] Kết hợp video với âm thanh thành công: ${temp_video_with_audio}`);
          
          // Ghi log thông tin về quá trình xử lý
          if (combineResult && combineResult.stderr) {
            fs.writeFileSync(`${logsDir}/combine_log_${id}.txt`, combineResult.stderr);
          }
        } catch (error) {
          console.error(`[Task ${id}] Lỗi khi kết hợp video với âm thanh: ${error.message || 'Unknown error'}`);
          if (error.stderr) {
            console.error(`[Task ${id}] Chi tiết lỗi FFmpeg: ${error.stderr}`);
            fs.writeFileSync(`${logsDir}/combine_error_${id}.txt`, error.stderr);
          }
          
          // Kiểm tra xem file đầu ra có tồn tại không
          if (!fs.existsSync(temp_video_with_audio)) {
            throw new Error(`Không thể tạo file video với âm thanh ${temp_video_with_audio}: ${error.message || 'Unknown error'}`);
          }
        }

        // --- Bước 7: Tải và thêm phụ đề vào video ---
        const subtitle_file = `subtitle_${id}.srt`;
        
        try {
          console.log(`[Task ${id}] Bắt đầu tải phụ đề từ ${subtitleUrl}`);
          
          // Tải phụ đề với timeout
          let response, subtitleData;
          try {
            // Thêm timeout cho fetch request
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 giây timeout
            
            console.log(`[Task ${id}] Đang gửi request tải phụ đề...`);
            response = await fetch(subtitleUrl, { signal: controller.signal });
            clearTimeout(timeoutId);
            
            console.log(`[Task ${id}] Nhận response từ server phụ đề: ${response.status}`);
            
            if (!response.ok) {
              throw new Error(`Không thể tải phụ đề, mã lỗi: ${response.status}`);
            }
            
            console.log(`[Task ${id}] Đang đọc dữ liệu phụ đề...`);
            subtitleData = await response.text();
            console.log(`[Task ${id}] Đã nhận dữ liệu phụ đề, kích thước: ${subtitleData.length} bytes`);
            
            // Kiểm tra dữ liệu phụ đề
            if (!subtitleData || subtitleData.trim().length === 0) {
              throw new Error('Dữ liệu phụ đề trống');
            }
            
            console.log(`[Task ${id}] Đang ghi file phụ đề: ${subtitle_file}`);
            fs.writeFileSync(subtitle_file, subtitleData);
            console.log(`[Task ${id}] Đã tải và lưu phụ đề thành công: ${subtitle_file}`);
          } catch (fetchError) {
            console.error(`[Task ${id}] Lỗi khi tải phụ đề: ${fetchError.message}`);
            
            // Nếu lỗi là do timeout hoặc network
            if (fetchError.name === 'AbortError') {
              console.error(`[Task ${id}] Request tải phụ đề bị timeout sau 30 giây`);
            }
            
            // Tạo file phụ đề trống nếu không tải được
            console.log(`[Task ${id}] Tạo file phụ đề trống để tiếp tục xử lý`);
            fs.writeFileSync(subtitle_file, '1\n00:00:00,000 --> 00:00:05,000\nKhông thể tải phụ đề\n\n');
            console.log(`[Task ${id}] Đã tạo file phụ đề trống: ${subtitle_file}`);
          }

          // Thêm phụ đề vào video
          const final_video = `final_video_${id}.mp4`;
          const argsSubtitle = [
            "-y", "-threads", "0",
            "-i", temp_video_with_audio,
            "-vf", `subtitles=${subtitle_file}:force_style='FontName=Arial,FontSize=16,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BackColour=&H80000000,Bold=1,Italic=0,Alignment=2,MarginV=30'`,
            "-c:a", "copy",
            final_video
          ];
          
          console.log(`[Task ${id}] Bắt đầu thêm phụ đề vào video`);
          console.log(`[Task ${id}] File video đầu vào: ${temp_video_with_audio}`);
          console.log(`[Task ${id}] File phụ đề: ${subtitle_file}`);
          console.log(`[Task ${id}] Tham số FFmpeg: ${JSON.stringify(argsSubtitle)}`);
          
          // Kiểm tra các file đầu vào tồn tại
          if (!fs.existsSync(temp_video_with_audio)) {
            console.error(`[Task ${id}] File video đầu vào không tồn tại: ${temp_video_with_audio}`);
            throw new Error(`File video đầu vào không tồn tại: ${temp_video_with_audio}`);
          }
          if (!fs.existsSync(subtitle_file)) {
            console.error(`[Task ${id}] File phụ đề không tồn tại: ${subtitle_file}`);
            throw new Error(`File phụ đề không tồn tại: ${subtitle_file}`);
          }
          
          // Thiết lập timeout cho quá trình thêm phụ đề
          let subtitleTimeout;
          const timeoutPromise = new Promise((_, reject) => {
            subtitleTimeout = setTimeout(() => {
              console.error(`[Task ${id}] Quá trình thêm phụ đề bị timeout sau 300 giây`);
              reject(new Error('Quá trình thêm phụ đề bị timeout sau 300 giây'));
            }, 300000); // 5 phút timeout
          });
          
          try {
            console.log(`[Task ${id}] Đang chạy FFmpeg để thêm phụ đề...`);
            const subtitleResult = await Promise.race([
              runFFmpeg(argsSubtitle),
              timeoutPromise
            ]);
            
            clearTimeout(subtitleTimeout);
            console.log(`[Task ${id}] Thêm phụ đề vào video thành công: ${final_video}`);
            
            // Ghi log thông tin về quá trình xử lý
            if (subtitleResult && subtitleResult.stderr) {
              console.log(`[Task ${id}] Ghi log FFmpeg cho quá trình thêm phụ đề`);
              fs.writeFileSync(`${logsDir}/subtitle_log_${id}.txt`, subtitleResult.stderr);
            }
            
            // Kiểm tra file đầu ra
            if (!fs.existsSync(final_video)) {
              console.error(`[Task ${id}] File video cuối cùng không tồn tại sau khi xử lý: ${final_video}`);
              throw new Error(`File video cuối cùng không tồn tại: ${final_video}`);
            }
            
            console.log(`[Task ${id}] Hoàn thành quá trình thêm phụ đề, kích thước file: ${fs.statSync(final_video).size} bytes`);
            
            // --- Bước 8: (Tùy chọn) Dọn dẹp các file tạm ---
            try {
              console.log(`[Task ${id}] Bắt đầu dọn dẹp các file tạm`);
              
              // Danh sách các file cần xóa
              const filesToDelete = [
                imagesListFilename,
                listFile,
                subtitle_file,
                temp_video_no_audio,
                temp_video_with_audio
              ];
              
              // Xóa từng file
              for (const file of filesToDelete) {
                if (fs.existsSync(file)) {
                  fs.unlinkSync(file);
                  console.log(`[Task ${id}] Đã xóa file tạm: ${file}`);
                }
              }
              
              // Xóa thư mục tạm
              if (fs.existsSync(tempDir)) {
                fs.rmSync(tempDir, { recursive: true, force: true });
                console.log(`[Task ${id}] Đã xóa thư mục tạm: ${tempDir}`);
              }
              
              console.log(`[Task ${id}] Đã hoàn thành dọn dẹp các file tạm`);
            } catch (cleanupError) {
              console.error(`[Task ${id}] Lỗi khi dọn dẹp các file tạm: ${cleanupError.message}`);
              // Không throw lỗi ở đây vì việc dọn dẹp không ảnh hưởng đến kết quả cuối cùng
            }
            
            return final_video;
          } catch (ffmpegError) {
            clearTimeout(subtitleTimeout);
            console.error(`[Task ${id}] Lỗi FFmpeg khi thêm phụ đề: ${ffmpegError.message || 'Unknown error'}`);
            throw ffmpegError;
          }
        } catch (error) {
          console.error(`[Task ${id}] Lỗi khi thêm phụ đề vào video: ${error.message || 'Unknown error'}`);
          if (error.stderr) {
            console.error(`[Task ${id}] Chi tiết lỗi FFmpeg: ${error.stderr}`);
            fs.writeFileSync(`${logsDir}/subtitle_error_${id}.txt`, error.stderr);
          }
          
          // Nếu có lỗi khi thêm phụ đề, trả về video có âm thanh nhưng không có phụ đề
          console.log(`[Task ${id}] Trả về video không có phụ đề do lỗi: ${temp_video_with_audio}`);
          return temp_video_with_audio;
        }
      } catch (error) {
        console.error(`[Task ${id}] Lỗi trong quá trình xử lý task: ${error.message}`);
        throw error;
      }
    })();
    
    // Chạy task với timeout
    const result = await Promise.race([processPromise, taskTimeoutPromise]);
    
    // Ghi log thời gian hoàn thành
    const duration = (Date.now() - startTime) / 1000;
    console.log(`[Task ${id}] Hoàn thành task sau ${duration} giây`);
    
    return result;
  } catch (error) {
    const duration = (Date.now() - startTime) / 1000;
    console.error(`[Task ${id}] Task thất bại sau ${duration} giây: ${error.message}`);
    
    // Ghi log lỗi
    try {
      fs.writeFileSync(`${logsDir}/task_${id}_error.txt`, JSON.stringify({
        error: error.message,
        stack: error.stack,
        time: new Date().toISOString(),
        duration: duration
      }, null, 2));
    } catch (logError) {
      console.error(`[Task ${id}] Không thể ghi log lỗi: ${logError.message}`);
    }
    
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
    console.log(`Processing task with id: ${task.id}`);
    const finalVideo = await processTask(task);
    
    // Tạo URL để tải video
    const host = req.get('host');
    const protocol = req.protocol;
    const downloadUrl = `${protocol}://${host}/download/${finalVideo}`;
    
    res.send({ 
      id: task.id, 
      finalVideo,
      downloadUrl,
      status: 'success',
      message: 'Video đã được xử lý thành công'
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
  
  console.log(`Streaming file: ${filename}, size: ${fileSize} bytes`);
});

// Endpoint mới: lấy danh sách video đã xử lý
app.get('/videos', (req, res) => {
  try {
    // Tìm tất cả các file video final
    const files = fs.readdirSync('.');
    const videoFiles = files.filter(file => file.startsWith('final_video_') && file.endsWith('.mp4'));
    
    // Tạo danh sách video với URL tải
    const host = req.get('host');
    const protocol = req.protocol;
    const videos = videoFiles.map(file => {
      const stats = fs.statSync(file);
      const id = file.replace('final_video_', '').replace('.mp4', '');
      return {
        id,
        filename: file,
        size: stats.size,
        created: stats.mtime,
        downloadUrl: `${protocol}://${host}/download/${file}`
      };
    });
    
    res.send({ videos });
  } catch (error) {
    console.error('Error getting video list:', error);
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
