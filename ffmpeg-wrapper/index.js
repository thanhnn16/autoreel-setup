const express = require('express');
const { exec } = require('child_process');

const app = express();
app.use(express.json()); // Hỗ trợ JSON body

// Endpoint nhận POST request để chạy ffmpeg
app.post('/run', (req, res) => {
  const { command } = req.body;
  
  if (!command || typeof command !== 'string') {
    return res.status(400).json({ error: 'Thiếu hoặc sai tham số "command".' });
  }
  
  // (Tùy chọn) Kiểm tra bảo mật cơ bản – tránh các lệnh nguy hiểm
  if (command.includes('rm ') || command.includes(';')) {
    return res.status(400).json({ error: 'Command không hợp lệ.' });
  }
  
  // Lệnh đầy đủ: "ffmpeg [command]"
  const fullCommand = `ffmpeg ${command}`;
  
  exec(fullCommand, (error, stdout, stderr) => {
    if (error) {
      return res.status(500).json({ error: error.message, stderr });
    }
    res.json({ stdout, stderr });
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`FFmpeg Wrapper đang chạy trên cổng ${PORT}`));
