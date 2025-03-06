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
      reject(new Error(`[Task ${id}] Quá trình xử lý task bị timeout sau ${(TASK_TIMEOUT/60000)} phút`));
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

        // Tính tổng thời gian video
        const total_duration = durations.reduce((acc, d) => acc + parseFloat(d), 0);
        console.log(`[Task ${id}] Tổng thời gian video: ${total_duration} giây`);

        // --- Bước 2: Tạo thư mục chứa video tạm ---
        const tempDir = `temp_videos_${id}`;
        if (!fs.existsSync(tempDir)) {
          fs.mkdirSync(tempDir, { recursive: true });
          writeLog(`[Task ${id}] Đã tạo thư mục tạm: ${tempDir}`, 'INFO');
        }

        // --- Bước 3: Tạo video cho từng ảnh với hiệu ứng Ken Burns nâng cao ---
        for (let i = 0; i < images.length; i++) {
          const image = images[i];
          const duration = durations[i];
          const index = i + 1;

          // Tính toán các thông số hiệu ứng Ken Burns
          const zoom_start = 1.1;
          const zoom_end = 1.2;
          
          // Trong FFmpeg 7.1, cần đảm bảo các biểu thức được đặt trong dấu ngoặc đơn và không có lỗi cú pháp
          // Sử dụng biểu thức đơn giản hơn để tránh lỗi
          // Thay vì sử dụng biểu thức phức tạp, sử dụng giá trị cố định
          const zoompan_filter = `zoompan=z=1.15:d=${Math.round(fps*duration)}:x='iw/2-(iw/zoom)/2':y='ih/2-(ih/zoom)/2':s=${video_width}x${video_height}:fps=${fps}`;
          
          const filter_complex = [
            `scale=720:1280:force_original_aspect_ratio=increase`,
            `crop=720:1280`,
            zoompan_filter
          ].join(',');

          // Tạo thư mục tạm nếu chưa tồn tại
          if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
          }

          // Tải ảnh về local trước khi xử lý để tránh lỗi với URL có ký tự đặc biệt
          const localImagePath = `${tempDir}/image_${index}.png`;
          try {
            await downloadFile(image, localImagePath);
            writeLog(`[Task ${id}] Đã tải ảnh ${index} vào ${localImagePath}`, 'INFO');
          } catch (error) {
            writeLog(`[Task ${id}] Lỗi khi tải ảnh ${index}: ${error.message}`, 'ERROR');
            throw error;
          }

          const args = [
            "-y", "-threads", "0",
            "-loop", "1", "-i", localImagePath,
            "-t", duration.toString(),
            "-vf", filter_complex,
            "-c:v", "libx264",
            "-pix_fmt", "yuv420p",
            "-preset", preset,
            "-crf", video_quality.toString(),
            `${tempDir}/${index}.mp4`
          ];
          
          try {
            console.log(`[Task ${id}] Xử lý ảnh ${index}: ${image}`);
            writeLog(`[Task ${id}] Bắt đầu xử lý ảnh ${index} với lệnh: ${args.join(' ')}`, 'INFO');
            await runFFmpeg(args);
            console.log(`[Task ${id}] Đã xử lý xong ảnh ${index}`);
          } catch (error) {
            console.error(`[Task ${id}] Lỗi khi xử lý ảnh ${index}:`, error);
            // Ghi log chi tiết về lỗi
            writeLog(`[Task ${id}] Lỗi chi tiết khi xử lý ảnh ${index}: ${JSON.stringify(error)}`, 'ERROR');
            throw new Error(`Lỗi khi xử lý ảnh ${index}: ${error.message || 'Lỗi không xác định'}`);
          }
        }

        // --- Bước 4: Tạo file danh sách video tạm ---
        const listFile = `list_${id}.txt`;
        let listContent = '';
        for (let i = 1; i <= images.length; i++) {
          listContent += `file '${tempDir}/${i}.mp4'\n`;
        }
        fs.writeFileSync(listFile, listContent);

        // --- Bước 5: Nối video và thêm hiệu ứng chuyển cảnh ---
        const temp_video_no_audio = `temp_video_no_audio_${id}.mp4`;
        const fade_duration = 0.5;
        const xfade_duration = 0.5;
        
        // Tạo chuỗi filter complex cho hiệu ứng chuyển cảnh
        let filter_complex = [];
        let inputs = [];
        
        // Thêm input cho mỗi video
        for (let i = 1; i <= images.length; i++) {
          inputs.push("-i", `${tempDir}/${i}.mp4`);
        }
        
        // Tạo chuỗi filter complex
        for (let i = 0; i < images.length; i++) {
          if (i === 0) {
            // Video đầu tiên
            filter_complex.push(`[${i}:v]fade=t=in:st=0:d=${fade_duration}[v${i}]`);
          } else {
            // Các video còn lại với hiệu ứng xfade
            // Trong FFmpeg 7.1, cần đảm bảo rằng các video đầu vào có cùng kích thước và framerate
            // Sử dụng hiệu ứng fade đơn giản hơn thay vì xfade để tránh lỗi
            filter_complex.push(
              `[v${i-1}][${i}:v]xfade=transition=fade:duration=${xfade_duration}[v${i}]`
            );
          }
        }
        
        // Thêm fade out cho video cuối
        const last_idx = images.length - 1;
        filter_complex.push(
          `[v${last_idx}]fade=t=out:st=${total_duration-fade_duration}:d=${fade_duration}[vout]`
        );

        const argsConcat = [
          "-y", "-threads", "0",
          ...inputs,
          "-filter_complex", filter_complex.join(';'),
          "-map", "[vout]",
          "-c:v", "libx264",
          "-pix_fmt", "yuv420p",
          "-preset", preset,
          "-crf", video_quality.toString(),
          temp_video_no_audio
        ];
        
        try {
          console.log(`[Task ${id}] Bắt đầu nối video và thêm hiệu ứng chuyển cảnh`);
          console.log(`[Task ${id}] Tham số FFmpeg: ${JSON.stringify(argsConcat)}`);
          
          const concatResult = await runFFmpeg(argsConcat);
          console.log(`[Task ${id}] Nối video thành công: ${temp_video_no_audio}`);
          
          // Ghi log thông tin về quá trình xử lý
          if (concatResult && concatResult.stderr) {
            fs.writeFileSync(`${logsDir}/concat_log_${id}.txt`, concatResult.stderr);
            writeLog(`[Task ${id}] Đã ghi log cho quá trình nối video`, 'INFO');
          }

          // --- Bước 6: Tải và xử lý file âm thanh ---
          const voice_file = `voice_${id}.mp3`;
          const bg_file = `bg_${id}.mp3`;
          
          // Tải file voice và background
          await Promise.all([
            downloadFile(voiceUrl, voice_file),
            downloadFile(bgUrl, bg_file)
          ]);

          // --- Bước 7: Mix âm thanh ---
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

          // --- Bước 8: Tạo subtitle ASS ---
          if (subtitleUrl) {
            try {
              const subtitle_file = `subtitle_${id}.srt`;
              await downloadFile(subtitleUrl, subtitle_file);
              
              // Chuyển đổi SRT sang ASS với hiệu ứng karaoke
              const subtitle_ass = `subtitle_${id}.ass`;
              
              // Kiểm tra xem file basic-ass-creator.ps1 có tồn tại không
              const scriptPath = "./ffmpeg-test/basic-ass-creator.ps1";
              if (!fs.existsSync(scriptPath)) {
                writeLog(`[Task ${id}] Không tìm thấy file script ${scriptPath}, sử dụng subtitle SRT trực tiếp`, 'WARNING');
                
                // Sử dụng subtitle SRT trực tiếp thay vì chuyển đổi sang ASS
                const output_file = `output_${id}.mp4`;
                const finalArgs = [
                  "-y", "-threads", "0",
                  "-i", temp_video_no_audio,
                  "-i", temp_audio,
                  "-i", subtitle_file,
                  "-map", "0:v",
                  "-map", "1:a",
                  "-map", "2:s",
                  "-c:v", "libx264",
                  "-c:a", "aac",
                  "-c:s", "mov_text",
                  "-metadata:s:s:0", `language=vie`,
                  "-shortest",
                  output_file
                ];
                
                await runFFmpeg(finalArgs);
                
                // Ghi log cho quá trình xử lý subtitle
                writeLog(`[Task ${id}] Đã thêm subtitle SRT thành công`, 'INFO');
                
                // Xóa các file tạm nhưng giữ lại log
                fs.unlinkSync(subtitle_file);
              } else {
                // Tạo file ASS từ PowerShell script
                const createAssArgs = [
                  "-File", scriptPath,
                  subtitle_file,
                  "output.json",
                  subtitle_ass,
                  titleText || "Video Title"
                ];
                
                await new Promise((resolve, reject) => {
                  const process = spawn("powershell", createAssArgs);
                  process.on('close', (code) => {
                    if (code === 0) resolve();
                    else reject(new Error(`Failed to create ASS subtitle with code ${code}`));
                  });
                });

                // --- Bước 9: Kết hợp video, audio và subtitle ---
                const output_file = `output_${id}.mp4`;
                const finalArgs = [
                  "-y", "-threads", "0",
                  "-i", temp_video_no_audio,
                  "-i", temp_audio,
                  "-i", subtitle_ass,
                  "-map", "0:v",
                  "-map", "1:a",
                  "-map", "2:s",
                  "-c:v", "libx264",
                  "-c:a", "aac",
                  "-c:s", "copy",
                  "-metadata:s:s:0", `language=vie`,
                  "-shortest",
                  output_file
                ];
                
                await runFFmpeg(finalArgs);
                
                // Ghi log cho quá trình xử lý subtitle
                writeLog(`[Task ${id}] Đã thêm subtitle ASS thành công`, 'INFO');
                
                // Xóa các file tạm nhưng giữ lại log
                fs.unlinkSync(subtitle_file);
                fs.unlinkSync(subtitle_ass);
              }
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
                "-shortest",
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
              "-shortest",
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
            if (fs.existsSync(listFile)) fs.unlinkSync(listFile);
            if (fs.existsSync(imagesListFilename)) fs.unlinkSync(imagesListFilename);
            
            // Xóa thư mục tạm và các file trong đó
            if (fs.existsSync(tempDir)) {
              const files = fs.readdirSync(tempDir);
              for (const file of files) {
                fs.unlinkSync(path.join(tempDir, file));
              }
              fs.rmdirSync(tempDir);
            }
            
            writeLog(`[Task ${id}] Đã xóa các file tạm`, 'INFO');
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
            totalDuration: total_duration,
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
          throw new Error(`Lỗi khi nối video: ${error.message}`);
        }
        
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
    console.log(`Processing task with id: ${task.id}`);
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
