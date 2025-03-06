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

console.log = function() {
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

console.error = function() {
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

// Hàm chuyển đổi SRT sang định dạng JSON cho Whisper
function convertSrtToWhisperJson(srtContent) {
  const lines = srtContent.split(/\r?\n/);
  const words = [];
  let currentStartTime = 0;
  let currentEndTime = 0;
  let currentText = '';
  let inSubtitle = false;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    // Bỏ qua dòng trống và số thứ tự
    if (line === '' || /^\d+$/.test(line)) {
      if (inSubtitle && currentText) {
        // Kết thúc một phụ đề, xử lý văn bản
        const wordTexts = currentText.split(/\s+/);
        const wordDuration = (currentEndTime - currentStartTime) / wordTexts.length;
        
        for (let j = 0; j < wordTexts.length; j++) {
          const wordText = wordTexts[j].trim();
          if (wordText) {
            const wordStart = currentStartTime + j * wordDuration;
            const wordEnd = wordStart + wordDuration;
            
            words.push({
              word: wordText,
              start: wordStart,
              end: wordEnd,
              confidence: 0.9
            });
          }
        }
        
        currentText = '';
        inSubtitle = false;
      }
      continue;
    }
    
    // Xử lý dòng thời gian
    const timeMatch = line.match(/(\d{2}):(\d{2}):(\d{2}),(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2}),(\d{3})/);
    if (timeMatch) {
      // Chuyển đổi thời gian sang giây
      const startHours = parseInt(timeMatch[1]);
      const startMinutes = parseInt(timeMatch[2]);
      const startSeconds = parseInt(timeMatch[3]);
      const startMilliseconds = parseInt(timeMatch[4]);
      
      const endHours = parseInt(timeMatch[5]);
      const endMinutes = parseInt(timeMatch[6]);
      const endSeconds = parseInt(timeMatch[7]);
      const endMilliseconds = parseInt(timeMatch[8]);
      
      currentStartTime = startHours * 3600 + startMinutes * 60 + startSeconds + startMilliseconds / 1000;
      currentEndTime = endHours * 3600 + endMinutes * 60 + endSeconds + endMilliseconds / 1000;
      
      inSubtitle = true;
      continue;
    }
    
    // Xử lý dòng văn bản
    if (inSubtitle) {
      if (currentText) {
        currentText += ' ' + line;
      } else {
        currentText = line;
      }
    }
  }
  
  // Xử lý phụ đề cuối cùng nếu có
  if (inSubtitle && currentText) {
    const wordTexts = currentText.split(/\s+/);
    const wordDuration = (currentEndTime - currentStartTime) / wordTexts.length;
    
    for (let j = 0; j < wordTexts.length; j++) {
      const wordText = wordTexts[j].trim();
      if (wordText) {
        const wordStart = currentStartTime + j * wordDuration;
        const wordEnd = wordStart + wordDuration;
        
        words.push({
          word: wordText,
          start: wordStart,
          end: wordEnd,
          confidence: 0.9
        });
      }
    }
  }
  
  // Tạo đối tượng JSON theo định dạng của Whisper
  return [{
    text: words.map(w => w.word).join(' '),
    segments: [{
      id: 0,
      start: words.length > 0 ? words[0].start : 0,
      end: words.length > 0 ? words[words.length - 1].end : 0,
      text: words.map(w => w.word).join(' ')
    }],
    words: words
  }];
}

// Hàm tạo file output.json từ whisper data
function createOutputJson(whisperData) {
  if (!whisperData || !whisperData[0] || !whisperData[0].words || whisperData[0].words.length === 0) {
    return [{ groups: [] }];
  }
  
  const words = whisperData[0].words;
  const groups = [];
  
  // Nhóm các từ thành các đoạn phụ đề
  const maxWordsPerGroup = 10; // Số từ tối đa trong một nhóm
  const minWordsPerGroup = 3; // Số từ tối thiểu trong một nhóm
  
  let currentGroup = {
    start: words[0].start,
    end: words[0].end,
    startIndex: 0,
    endIndex: 0
  };
  
  for (let i = 1; i < words.length; i++) {
    const word = words[i];
    const previousWord = words[i - 1];
    const timeDiff = word.start - previousWord.end;
    
    // Nếu khoảng cách thời gian giữa các từ lớn hoặc đã đủ số từ tối đa, tạo nhóm mới
    if (timeDiff > 0.7 || (i - currentGroup.startIndex) >= maxWordsPerGroup) {
      // Chỉ thêm nhóm nếu có đủ số từ tối thiểu
      if ((currentGroup.endIndex - currentGroup.startIndex + 1) >= minWordsPerGroup) {
        groups.push({ ...currentGroup });
      }
      
      // Bắt đầu nhóm mới
      currentGroup = {
        start: word.start,
        end: word.end,
        startIndex: i,
        endIndex: i
      };
    } else {
      // Cập nhật thời gian kết thúc và chỉ số kết thúc của nhóm hiện tại
      currentGroup.end = word.end;
      currentGroup.endIndex = i;
    }
  }
  
  // Thêm nhóm cuối cùng nếu có đủ số từ tối thiểu
  if ((currentGroup.endIndex - currentGroup.startIndex + 1) >= minWordsPerGroup) {
    groups.push({ ...currentGroup });
  }
  
  return [{ groups }];
}

// Hàm tạo phụ đề ASS từ file JSON của Whisper
async function createAssSubtitle(whisperJsonPath, outputJsonPath, assFilePath) {
  writeLog(`Bắt đầu tạo phụ đề ASS từ ${whisperJsonPath} và ${outputJsonPath}`, 'INFO');
  
  // Kiểm tra file JSON có tồn tại không
  if (!fs.existsSync(whisperJsonPath)) {
    writeLog(`File ${whisperJsonPath} không tồn tại.`, 'ERROR');
    return false;
  }
  
  if (!fs.existsSync(outputJsonPath)) {
    writeLog(`File ${outputJsonPath} không tồn tại.`, 'ERROR');
    return false;
  }
  
  try {
    // Đọc dữ liệu từ file JSON
    const whisperData = JSON.parse(fs.readFileSync(whisperJsonPath, 'utf8'));
    const outputData = JSON.parse(fs.readFileSync(outputJsonPath, 'utf8'));
    
    // Thiết lập các biến cấu hình
    const defaultColor = "FFFFFF"; // Màu chữ mặc định (định dạng: bbggrr)
    const highlightColor = "0CF4FF"; // Màu highlight (định dạng: bbggrr)
    const outlineColor = "000000"; // Màu viền
    const shadowColor = "000000"; // Màu bóng đổ
    const titleText = "Auto Reel"; // Văn bản tiêu đề
    const titleColor1 = "00FFFF"; // Màu gradient 1 cho title (định dạng: bbggrr)
    const titleColor2 = "FF00FF"; // Màu gradient 2 cho title (định dạng: bbggrr)
    const titleDuration = 7.0; // Thời gian hiển thị title (giây)
    const minWordCount = 3; // Số từ tối thiểu cho một phụ đề
    const maxCharsPerLine = 35; // Số ký tự tối đa trên mỗi dòng
    const maxSubtitleLines = 2; // Số dòng tối đa cho phụ đề
    
    // Tạo header cho file ASS
    const assHeader = createAssHeader();
    let assContent = assHeader;
    
    // Lấy dữ liệu từ whisper
    const transcription = whisperData[0];
    const allWords = transcription.words;
    
    // Lấy dữ liệu từ output.json
    const groups = outputData[0].groups;
    
    // Xử lý từng nhóm phụ đề
    for (const group of groups) {
      const startTime = group.start;
      const endTime = group.end;
      const startIndex = group.startIndex;
      const endIndex = group.endIndex;
      
      // Lấy các từ trong nhóm này từ whisper data
      const groupWords = allWords.slice(startIndex, endIndex + 1);
      
      // Bỏ qua nhóm chỉ có ít từ
      if (groupWords.length < minWordCount) {
        writeLog(`Bỏ qua phụ đề chỉ có ${groupWords.length} từ: ${groupWords[0].word}`, 'INFO');
        continue;
      }
      
      // Tạo hiệu ứng highlight cho nhóm từ này
      const dialogueLine = createHighlightDialogueLine(startTime, endTime, groupWords, {
        defaultColor,
        highlightColor,
        outlineColor,
        shadowColor,
        maxCharsPerLine,
        maxSubtitleLines
      });
      
      if (dialogueLine !== "") {
        assContent += "\n" + dialogueLine;
      }
    }
    
    // Thêm dòng tiêu đề nếu cần
    if (titleText && titleText.trim() !== "") {
      const titleLine = createTitleLine({
        titleText,
        titleColor1,
        titleColor2,
        titleDuration
      });
      assContent = assContent + "\n" + titleLine;
    }
    
    // Ghi nội dung ASS vào file
    fs.writeFileSync(assFilePath, assContent, 'utf8');
    writeLog(`Đã tạo thành công file phụ đề ASS: ${assFilePath}`, 'INFO');
    
    return true;
  } catch (error) {
    writeLog(`Lỗi khi chuyển đổi file: ${error.message}`, 'ERROR');
    return false;
  }
}

// Hàm tạo header cho file ASS
function createAssHeader() {
  // Script Info
  const scriptInfo = 
`[Script Info]
; Script generated by AutoReel
Title: Beautiful ASS Subtitle
ScriptType: v4.00+
Collisions: Normal
PlayResX: 1920
PlayResY: 1080
Timer: 100.0000
WrapStyle: 2
LineBreakStyle: 1`;

  // Styles
  const stylesHeader = 
`
[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding`;

  // Default style
  const defaultStyle = "Style: Default,Arial,32,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,2.5,1.5,2,20,20,60,1";
  const titleStyle = "Style: Title,Arial,72,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,3,2,8,10,10,10,1";
  
  // Events
  const eventsHeader = 
`
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`;

  // Kết hợp tất cả
  return scriptInfo + stylesHeader + "\n" + defaultStyle + "\n" + titleStyle + eventsHeader;
}

// Hàm định dạng thời gian cho ASS
function formatAssTime(seconds) {
  const totalCentiseconds = Math.floor(seconds * 100);
  const cs = totalCentiseconds % 100;
  const totalSeconds = Math.floor(totalCentiseconds / 100);
  const s = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const m = totalMinutes % 60;
  const h = Math.floor(totalMinutes / 60);
  
  // Định dạng H:MM:SS.cs
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

// Hàm tạo dòng dialogue với hiệu ứng highlight từng từ
function createHighlightDialogueLine(startTime, endTime, wordObjects, options) {
  // Kiểm tra số lượng từ, bỏ qua nếu chỉ có ít từ
  if (wordObjects.length < options.minWordCount || wordObjects.length < 3) {
    return "";
  }
  
  // Định dạng thời gian bắt đầu và kết thúc
  const startTimeAss = formatAssTime(startTime);
  const endTimeAss = formatAssTime(endTime);
  
  // Tạo tag fade đẹp hơn với thời gian fade in/out
  const fadeTag = "\\fad(200,200)";
  
  // Tạo các tag hiệu ứng cơ bản
  const blurTag = "\\blur0.6";
  const borderTag = "\\bord1.8";
  const shadowTag = "\\shad1.2";
  const spacingTag = "\\fsp0.5";
  
  // Tạo tag hiệu ứng cơ bản
  const basicEffect = `{${fadeTag}${blurTag}${borderTag}${shadowTag}${spacingTag}}`;
  
  // Tạo tag màu mặc định và highlight
  const defaultColorTag = `\\c&H${options.defaultColor}`;
  const highlightColorTag = `\\c&H${options.highlightColor}`;
  const outlineTag = `\\3c&H${options.outlineColor}`;
  const shadowColorTag = `\\4c&H${options.shadowColor}`;
  
  // Xây dựng chuỗi phụ đề với hiệu ứng highlight
  const dialogueLines = [];
  
  // Tạo một dòng phụ đề với màu mặc định cho tất cả các từ (layer 0)
  const defaultText = `{${defaultColorTag}${outlineTag}${shadowColorTag}}`;
  let fullText = "";
  for (const wordObj of wordObjects) {
    fullText += `${wordObj.word} `;
  }
  fullText = fullText.trim();
  
  // Xử lý chia văn bản thành tối đa 2 dòng
  const words = fullText.split(' ');
  let formattedText = "";
  let currentLine = "";
  let lineCount = 0;
  
  // Tính toán tổng số ký tự và phân phối đều cho 2 dòng
  const totalChars = fullText.length;
  const idealCharsPerLine = Math.ceil(totalChars / options.maxSubtitleLines);
  const effectiveMaxChars = Math.min(options.maxCharsPerLine, Math.max(idealCharsPerLine, 20));
  
  // Đảm bảo luôn có 2 dòng phụ đề nếu văn bản đủ dài
  const forceNewLine = totalChars > 30 && words.length > 3;
  
  // Xử lý trường hợp có từ quá dài
  const longWordThreshold = 20;
  const processedWords = [];
  for (const word of words) {
    if (word.length > longWordThreshold) {
      // Chia từ dài thành các phần nhỏ hơn
      for (let i = 0; i < word.length; i += longWordThreshold) {
        const length = Math.min(longWordThreshold, word.length - i);
        processedWords.push(word.substring(i, i + length));
      }
    } else {
      processedWords.push(word);
    }
  }
  
  for (const word of processedWords) {
    // Nếu đã có đủ số dòng tối đa, thêm từ vào dòng cuối
    if (lineCount >= (options.maxSubtitleLines - 1)) {
      if (currentLine.length > 0) {
        currentLine += " ";
      }
      currentLine += word;
    }
    // Nếu thêm từ này vào dòng hiện tại sẽ vượt quá giới hạn, tạo dòng mới
    else if ((currentLine.length + word.length + 1) > effectiveMaxChars || 
            (forceNewLine && lineCount === 0 && currentLine.length > (totalChars / 2))) {
      formattedText += currentLine;
      currentLine = word;
      lineCount++;
      
      // Thêm ký tự ngắt dòng
      if (lineCount < options.maxSubtitleLines) {
        formattedText += "\\N";
      }
    } 
    // Thêm từ vào dòng hiện tại
    else {
      if (currentLine.length > 0) {
        currentLine += " ";
      }
      currentLine += word;
    }
  }
  
  // Thêm dòng cuối cùng vào văn bản đã định dạng
  if (currentLine.length > 0) {
    // Nếu chưa có dòng nào, thêm trực tiếp
    if (formattedText.length === 0) {
      formattedText = currentLine;
    }
    // Nếu đã có dòng và chưa đạt số dòng tối đa, thêm ngắt dòng
    else if (lineCount < (options.maxSubtitleLines - 1)) {
      formattedText += "\\N" + currentLine;
    }
    // Nếu không, nối vào dòng cuối cùng
    else {
      formattedText += currentLine;
    }
  }
  
  // Thêm dòng phụ đề mặc định (layer 0)
  const dialoguePrefix = `Dialogue: 0,${startTimeAss},${endTimeAss},Default,,0,0,0,,`;
  dialogueLines.push(dialoguePrefix + basicEffect + defaultText + formattedText);
  
  // Tạo các dòng phụ đề highlight cho từng từ (layer 1)
  for (const wordObj of wordObjects) {
    const wordStart = wordObj.start;
    const wordEnd = wordObj.end;
    
    // Chỉ tạo highlight nếu từ nằm trong khoảng thời gian của đoạn
    if ((wordStart >= startTime) && (wordEnd <= endTime)) {
      // Định dạng thời gian bắt đầu và kết thúc cho từng từ
      const wordStartAss = formatAssTime(wordStart);
      const wordEndAss = formatAssTime(wordEnd);
      
      // Tạo hiệu ứng glow cho từ được highlight
      const glowTag = "\\4a&H30";
      
      // Tạo văn bản với từ được highlight
      const highlightText = `{${defaultColorTag}${outlineTag}${shadowColorTag}}`;
      
      // Tạo văn bản highlight với cùng định dạng dòng như văn bản gốc
      const lines = formattedText.split("\\N");
      let highlightFormattedText = "";
      
      for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
        const line = lines[lineIdx];
        const lineWords = line.split(' ');
        let highlightLine = "";
        
        for (const lineWord of lineWords) {
          if (lineWord === wordObj.word) {
            highlightLine += `{${highlightColorTag}${glowTag}}${lineWord}{${defaultColorTag}} `;
          } else {
            highlightLine += `${lineWord} `;
          }
        }
        
        highlightFormattedText += highlightLine.trim();
        
        // Thêm ngắt dòng nếu không phải dòng cuối
        if (lineIdx < lines.length - 1) {
          highlightFormattedText += "\\N";
        }
      }
      
      // Thêm dòng highlight cho từ này (layer 1)
      const highlightPrefix = `Dialogue: 1,${wordStartAss},${wordEndAss},Default,,0,0,0,,`;
      const highlightEffect = `{${blurTag}${borderTag}${shadowTag}${spacingTag}}`;
      dialogueLines.push(highlightPrefix + highlightEffect + highlightText + highlightFormattedText);
    }
  }
  
  return dialogueLines.join("\n");
}

// Hàm tạo dòng tiêu đề
function createTitleLine(options) {
  const { titleText, titleColor1, titleColor2, titleDuration } = options;
  
  // Tạo tag fade với hiệu ứng fade in/out mượt mà
  const fadeTag = "\\fad(1000,1000)";
  
  // Tạo tag vị trí ở giữa màn hình
  const posTag = "\\pos(960,540)";
  
  // Tạo tag hiệu ứng gradient màu
  const colorTag1 = `\\1c&H${titleColor1}`;
  const colorTag2 = `\\2c&H${titleColor2}`;
  
  // Tạo tag viền và shadow
  const outlineTag = "\\3c&H000000"; // Viền đen
  const blurTag = "\\blur1.2"; // Blur nhẹ
  const borderTag = "\\bord2.5"; // Viền
  const shadowTag = "\\shad1.5"; // Bóng
  
  // Tạo hiệu ứng transform
  const t1Start = `\\t(0,1000,\\fscx120\\fscy120\\blur5\\alpha&H30&)`;
  const t2Mid = `\\t(1000,2000,\\fscx100\\fscy100\\blur0.8\\alpha&H00&)`;
  
  // Tạo tag phát sáng nhẹ nhàng
  const glowTag = "\\4a&H40";
  
  // Kết hợp các tag cho tiêu đề chính
  const allTags = `{${fadeTag}${posTag}${colorTag1}${colorTag2}${outlineTag}${blurTag}${borderTag}${shadowTag}${glowTag}${t1Start}${t2Mid}}`;
  
  // Tạo dòng dialogue hoàn chỉnh với thời gian hiển thị
  const titleLine = `Dialogue: 0,0:00:00.00,0:00:0${titleDuration}.00,Title,,0,0,0,,${allTags}${titleText}`;
  
  // Tạo hiệu ứng nền mờ
  const rectBgTag = `{\\an5\\pos(960,540)\\p1\\bord0\\shad0\\blur8\\c&H101820\\alpha&HA0\\fad(1000,1000)}`;
  const rectPath = "m -460 -90 l 920 0 b 20 0 20 0 20 20 l 0 140 b 0 20 0 20 -20 20 l -920 0 b -20 0 -20 0 -20 -20 l 0 -140 b 0 -20 0 -20 20 -20";
  const rectBgLine = `Dialogue: -10,0:00:00.00,0:00:0${titleDuration}.00,Title,,0,0,0,,${rectBgTag}${rectPath}`;
  
  // Tạo viền phát sáng
  const rectGlowTag = `{\\an5\\pos(960,540)\\p1\\bord3\\blur5\\c&H${titleColor1}\\3c&H${titleColor2}\\alpha&H90\\fad(1000,1000)}`;
  const rectGlowLine = `Dialogue: -9,0:00:00.00,0:00:0${titleDuration}.00,Title,,0,0,0,,${rectGlowTag}${rectPath}`;
  
  return rectBgLine + "\n" + rectGlowLine + "\n" + titleLine;
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
      reject(new Error(`[Task ${id}] Quá trình xử lý task bị timeout sau ${(TASK_TIMEOUT/60000)} phút`));
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
        const zoomSpeed = 0.0008;
        const maxZoom = 1.3;
        
        // --- Bước 1: Tạo thư mục chứa video tạm ---
        const tempDir = `temp_videos_${id}`;
        if (!fs.existsSync(tempDir)) {
          fs.mkdirSync(tempDir, { recursive: true });
          writeLog(`[Task ${id}] Đã tạo thư mục tạm: ${tempDir}`, 'INFO');
        }

        // --- Bước 2: Tạo video cho từng ảnh với hiệu ứng Ken Burns nâng cao ---
        for (let i = 0; i < images.length; i++) {
          const image = images[i];
          let duration = durations[i];
          
          // Kéo dài thời gian hiển thị của ảnh cuối cùng thêm 2 giây
          if (i === images.length - 1) {
            duration = parseFloat(duration) + 2;
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

          // Tạo hiệu ứng Ken Burns khác nhau cho mỗi ảnh
          let zoompan_filter;
          switch (index % 8) {
            case 1:
              zoompan_filter = `scale=${largeScale}:-1,zoompan=z='min(zoom+${zoomSpeed},${maxZoom})':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${video_width}x${video_height}:fps=${fps}`;
              break;
            case 2:
              zoompan_filter = `scale=${largeScale}:-1,zoompan=z='if(eq(on,1),${maxZoom},zoom-${zoomSpeed})':x='iw-iw/zoom':y='0':d=${frames}:s=${video_width}x${video_height}:fps=${fps}`;
              break;
            case 3:
              zoompan_filter = `scale=${largeScale}:-1,zoompan=z='min(zoom+${zoomSpeed},${maxZoom})':x='0':y='ih-ih/zoom':d=${frames}:s=${video_width}x${video_height}:fps=${fps}`;
              break;
            case 4:
              zoompan_filter = `scale=${largeScale}:-1,zoompan=z='1.1':x='min(max((iw-iw/zoom)*((on)/${frames}),0),iw)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${video_width}x${video_height}:fps=${fps}`;
              break;
            case 5:
              zoompan_filter = `scale=${largeScale}:-1,zoompan=z='if(eq(on,1),${maxZoom},zoom-${zoomSpeed})':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${video_width}x${video_height}:fps=${fps}`;
              break;
            case 6:
              zoompan_filter = `scale=${largeScale}:-1,zoompan=z='1.1':x='iw/2-(iw/zoom/2)':y='min(max((ih-ih/zoom)*((on)/${frames}),0),ih)':d=${frames}:s=${video_width}x${video_height}:fps=${fps}`;
              break;
            case 7:
              zoompan_filter = `scale=${largeScale}:-1,zoompan=z='min(zoom+${zoomSpeed},${maxZoom})':x='iw-iw/zoom':y='0':d=${frames}:s=${video_width}x${video_height}:fps=${fps}`;
              break;
            case 0:
              zoompan_filter = `scale=${largeScale}:-1,zoompan=z='if(eq(on,1),${maxZoom},zoom-${zoomSpeed})':x='iw-iw/zoom':y='ih-ih/zoom':d=${frames}:s=${video_width}x${video_height}:fps=${fps}`;
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
              'fade', 'fadeblack', 'fadegrays', 'distance', 
              'wipeleft', 'circleclose', 'rectcrop', 'circleopen',
              'hblur', 'dissolve', 'pixelize', 'radial', 'slidedown'
            ];
            
            // Xử lý từng cặp video để tránh filter complex quá phức tạp
            let currentOutput = `${tempDir}/temp_0.mp4`;
            fs.copyFileSync(`${tempDir}/1.mp4`, currentOutput);
            
            // Thời lượng chuyển cảnh (giây)
            const transitionDuration = 0.5;
            
            for (let i = 1; i < images.length; i++) {
              const nextVideo = `${tempDir}/${i+1}.mp4`;
              const outputVideo = `${tempDir}/temp_${i}.mp4`;
              const transition = transitions[i % transitions.length];
              
              // Lấy thông tin thời lượng video hiện tại
              const probeArgs = [
                "-v", "error",
                "-show_entries", "format=duration",
                "-of", "default=noprint_wrappers=1:nokey=1",
                currentOutput
              ];
              
              const probeResult = await runFFprobe(probeArgs);
              const duration = parseFloat(probeResult.stdout.trim());
              
              // Tính offset (thời điểm bắt đầu hiệu ứng chuyển cảnh)
              // Đảm bảo offset không vượt quá thời lượng video
              const offset = Math.max(0.5, Math.min(duration - transitionDuration, duration * 0.8));
              
              // Tạo lệnh xfade
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
              
              writeLog(`[Task ${id}] Áp dụng hiệu ứng ${transition} giữa video ${i} và ${i+1}`, 'INFO');
              await runFFmpeg(xfadeArgs);
              
              // Cập nhật currentOutput cho vòng lặp tiếp theo
              if (i > 1) {
                // Xóa file tạm thời trước đó để tiết kiệm dung lượng
                fs.unlinkSync(currentOutput);
              }
              currentOutput = outputVideo;
            }
            
            // Đổi tên file cuối cùng thành output
            fs.copyFileSync(currentOutput, temp_video_no_audio);
            writeLog(`[Task ${id}] Nối video thành công: ${temp_video_no_audio}`, 'INFO');
            
            // Xóa các file tạm
            for (let i = 0; i < images.length - 1; i++) {
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
            const subtitle_file = `subtitle_${id}.srt`;
            await downloadFile(subtitleUrl, subtitle_file);
            
            // Chuyển đổi SRT sang ASS với hiệu ứng karaoke
            const subtitle_ass = `subtitle_${id}.ass`;
            
            // Kiểm tra xem có thể tạo file whisper-transcription.json và output.json không
            const whisperJsonPath = `whisper_${id}.json`;
            const outputJsonPath = `output_${id}.json`;
            let useInternalAssCreator = false;
            
            // Kiểm tra xem có thể tạo file JSON từ SRT không
            try {
              // Đọc nội dung file SRT
              const srtContent = fs.readFileSync(subtitle_file, 'utf8');
              
              // Chuyển đổi SRT thành định dạng JSON cho whisper
              const whisperData = convertSrtToWhisperJson(srtContent);
              fs.writeFileSync(whisperJsonPath, JSON.stringify(whisperData), 'utf8');
              
              // Tạo file output.json từ whisper data
              const outputData = createOutputJson(whisperData);
              fs.writeFileSync(outputJsonPath, JSON.stringify(outputData), 'utf8');
              
              // Sử dụng hàm createAssSubtitle để tạo file ASS
              const result = await createAssSubtitle(whisperJsonPath, outputJsonPath, subtitle_ass);
              
              if (result) {
                useInternalAssCreator = true;
                writeLog(`[Task ${id}] Đã tạo file ASS thành công bằng hàm nội bộ`, 'INFO');
              } else {
                writeLog(`[Task ${id}] Không thể tạo file ASS bằng hàm nội bộ, thử phương pháp khác`, 'WARNING');
              }
              
              // Xóa các file JSON tạm
              fs.unlinkSync(whisperJsonPath);
              fs.unlinkSync(outputJsonPath);
            } catch (error) {
              writeLog(`[Task ${id}] Lỗi khi chuyển đổi SRT sang JSON: ${error.message}`, 'WARNING');
            }
            
            // Nếu không thể tạo ASS bằng hàm nội bộ, thử sử dụng PowerShell script
            if (!useInternalAssCreator) {
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
              }
            }

            // --- Bước 7: Kết hợp video, audio và subtitle ---
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
              output_file
            ];
            
            await runFFmpeg(finalArgs);
            
            // Ghi log cho quá trình xử lý subtitle
            writeLog(`[Task ${id}] Đã thêm subtitle ASS thành công`, 'INFO');
            
            // Xóa các file tạm nhưng giữ lại log
            fs.unlinkSync(subtitle_file);
            if (fs.existsSync(subtitle_ass)) {
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
