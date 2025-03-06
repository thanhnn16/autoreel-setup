const express = require('express');
const { spawn } = require('child_process');
const app = express();

app.use(express.json());

// Endpoint để nhận request chạy ffmpeg
app.post('/ffmpeg', (req, res) => {
  const args = req.body.args;
  if (!args || !Array.isArray(args)) {
    return res.status(400).send({ error: 'args is required and must be an array' });
  }

  // Chạy lệnh ffmpeg với các tham số truyền vào
  const ffmpeg = spawn('ffmpeg', args);
  let stdout = '';
  let stderr = '';

  ffmpeg.stdout.on('data', (data) => { stdout += data.toString(); });
  ffmpeg.stderr.on('data', (data) => { stderr += data.toString(); });

  ffmpeg.on('close', (code) => {
    res.send({ code, stdout, stderr });
  });
});

app.listen(3000, () => {
  console.log('HTTP wrapper listening on port 3000');
});
