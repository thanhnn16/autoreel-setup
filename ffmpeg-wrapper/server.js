import express from 'express';
import { spawn } from 'child_process';
import fs from 'fs';
import fetch from 'node-fetch';

const app = express();
app.use(express.json());

// Hàm chạy ffmpeg và trả về Promise
function runFFmpeg(args) {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', args);
    let stdout = '';
    let stderr = '';

    ffmpeg.stdout.on('data', (data) => { stdout += data.toString(); });
    ffmpeg.stderr.on('data', (data) => { stderr += data.toString(); });

    ffmpeg.on('close', (code) => {
      if (code === 0) {
        resolve({ code, stdout, stderr });
      } else {
        reject({ code, stdout, stderr });
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

// Hàm xử lý toàn bộ workflow cho một task
async function processTask(task) {
  const { id, images, durations, voiceUrl, bgUrl, subtitleUrl } = task;
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
  console.log(`Total video duration: ${total_duration} seconds`);

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
    console.log(`Processing image ${index}: ${image}`);
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
  const fade_out_start = total_duration - 1; // tính đơn giản
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
  await runFFmpeg(argsConcat);

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
  await runFFmpeg(argsCombine);

  // --- Bước 7: Tải và thêm phụ đề vào video ---
  const subtitle_file = `subtitle_${id}.srt`;
  console.log(`Downloading subtitle from ${subtitleUrl}`);
  const response = await fetch(subtitleUrl);
  const subtitleData = await response.text();
  fs.writeFileSync(subtitle_file, subtitleData);

  const final_video = `final_video_${id}.mp4`;
  const argsSubtitle = [
    "-y", "-threads", "0",
    "-i", temp_video_with_audio,
    "-vf", `subtitles=${subtitle_file}:force_style='FontName=Arial,FontSize=16,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BackColour=&H80000000,Bold=1,Italic=0,Alignment=2,MarginV=30'`,
    "-c:a", "copy",
    final_video
  ];
  await runFFmpeg(argsSubtitle);

  // --- Bước 8: (Tùy chọn) Dọn dẹp các file tạm ---
  // Ví dụ: xóa file danh sách, folder tạm, v.v.
  // fs.unlinkSync(imagesListFilename);
  // fs.unlinkSync(listFile);
  // fs.unlinkSync(subtitle_file);
  // fs.rmSync(tempDir, { recursive: true, force: true });
  // fs.unlinkSync(temp_video_no_audio);
  // fs.unlinkSync(temp_video_with_audio);

  return final_video;
}

// Endpoint mới: nhận mảng task và xử lý workflow cho từng task
app.post('/process', async (req, res) => {
  const tasks = req.body.tasks;
  if (!tasks || !Array.isArray(tasks)) {
    return res.status(400).send({ error: 'tasks is required and must be an array' });
  }
  try {
    let results = [];
    for (const task of tasks) {
      console.log(`Processing task with id: ${task.id}`);
      const finalVideo = await processTask(task);
      results.push({ id: task.id, finalVideo });
    }
    res.send({ results });
  } catch (error) {
    console.error("Error processing tasks:", error);
    res.status(500).send({ error });
  }
});

app.listen(3000, () => {
  console.log('Improved HTTP wrapper listening on port 3000');
});
