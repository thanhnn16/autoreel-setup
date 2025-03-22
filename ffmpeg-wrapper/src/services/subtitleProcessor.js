/**
 * Service xử lý phụ đề
 */
import fs from 'fs';
import path from 'path';
import logger from '../utils/logger.js';
import { downloadFile } from './fileDownloader.js';
import { ensureDir } from '../utils/fileManager.js';
import ffmpegConfig from '../config/ffmpeg.js';
import { formatAssTime } from '../utils/ffmpeg.js';

/**
 * Xử lý file phụ đề ASS từ URL
 * @param {string} subtitleUrl - URL file ASS
 * @param {string} outputDir - Thư mục đích
 * @param {Object} options - Các tùy chọn
 * @returns {Promise<string>} - Đường dẫn file ASS
 */
async function processAssSubtitle(subtitleUrl, outputDir, options = {}) {
  const { taskId, filePrefix } = options;
  const logPrefix = taskId ? `[Task ${taskId}]` : '';
  
  try {
    logger.info(`${logPrefix} Bắt đầu tải phụ đề từ ${subtitleUrl}`, 'SubtitleProcessor');
    
    // Tạo tên file với đảm bảo có đuôi .ass
    let subtitleFilename;
    if (filePrefix) {
      // Sử dụng filePrefix và đảm bảo có .ass
      subtitleFilename = filePrefix.endsWith('.ass') ? filePrefix : `${filePrefix}.ass`;
    } else {
      // Sử dụng taskId
      subtitleFilename = `subtitle_${taskId || Date.now()}.ass`;
    }
    
    const subtitlePath = path.join(outputDir, subtitleFilename);
    
    // Đảm bảo thư mục tồn tại
    await ensureDir(outputDir);
    
    // Tải file
    await downloadFile(subtitleUrl, subtitlePath, {
      taskId,
      timeout: 30000,
      retries: 3
    });

    // Kiểm tra file
    if (!fs.existsSync(subtitlePath)) {
      throw new Error('File phụ đề tải xuống không tồn tại');
    }

    logger.info(`${logPrefix} Tải phụ đề thành công: ${subtitlePath}`, 'SubtitleProcessor');
    return subtitlePath;
  } catch (error) {
    logger.error(`${logPrefix} Lỗi xử lý phụ đề: ${error.message}`, 'SubtitleProcessor');
    throw error;
  }
}

/**
 * Tạo phụ đề tiêu đề với hiệu ứng
 */
function createTitleWithEffect(titleText, duration = 5) {
  const startTime = 0;
  const endTime = startTime + duration;
  
  // Hiệu ứng cho video dọc 1080x1920
  const videoWidth = 1080;
  const videoHeight = 1920;
  const centerX = videoWidth / 2;
  
  // Vị trí hiển thị ở giữa màn hình, điều chỉnh cho nhiều dòng
  const baseY = videoHeight * 0.45; // Đặt vị trí Y cao hơn một chút để có chỗ cho nhiều dòng
  const lineHeight = 120; // Khoảng cách giữa các dòng

  // Tối ưu thời gian
  const typingDuration = 1.7;
  
  // Các thông số cố định
  const charSpacing = 65;
  const wordSpacing = 85;
  const safeMargin = 40;
  const maxWidth = videoWidth - (safeMargin * 2);

  // Màu sắc cho hiệu ứng chuyển đổi
  const startColor = "&H00FFFFFF";   // Màu trắng
  const endColor = "&H0000A2FF";     // Màu cam vàng
  const startOutline = "&H000000FF"; // Viền đỏ đậm
  const endOutline = "&H002C3D55";   // Viền xanh đậm

  // Tách văn bản thành các từ
  const words = titleText.split(' ');
  const lines = [];
  let currentLine = [];
  let currentWidth = 0;

  // Phân chia từ thành các dòng với điều kiện đặc biệt cho dòng thứ 2
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const wordWidth = (word.length - 1) * charSpacing + wordSpacing;
    
    // Nếu từ hiện tại sẽ làm dòng vượt quá maxWidth và dòng hiện tại không trống
    if (currentWidth + wordWidth > maxWidth && currentLine.length > 0) {
      // Kiểm tra xem đây có phải là lần xuống dòng đầu tiên không
      if (lines.length === 0) {
        // Nếu còn ít hơn 2 từ cho dòng tiếp theo
        if (words.length - i < 2) {
          // Chuyển từ cuối của dòng hiện tại xuống dòng mới
          const lastWord = currentLine.pop();
          lines.push(currentLine);
          currentLine = [lastWord, word];
          currentWidth = (lastWord.length - 1) * charSpacing + wordSpacing + wordWidth;
        } else {
          lines.push(currentLine);
          currentLine = [word];
          currentWidth = wordWidth;
        }
      } else {
        lines.push(currentLine);
        currentLine = [word];
        currentWidth = wordWidth;
      }
    } else {
      currentLine.push(word);
      currentWidth += wordWidth;
    }
  }
  
  // Xử lý dòng cuối cùng
  if (currentLine.length > 0) {
    // Nếu chỉ có một dòng và dòng cuối chỉ có 1 từ, ghép với dòng trước
    if (lines.length === 1 && currentLine.length === 1) {
      const lastLineOfFirst = lines[0];
      const lastWordOfFirst = lastLineOfFirst.pop();
      lines[0] = lastLineOfFirst;
      currentLine.unshift(lastWordOfFirst);
    }
    lines.push(currentLine);
  }

  // Tính tổng số ký tự để chia thời gian
  const totalChars = titleText.replace(/ /g, '').length;
  const charDuration = (typingDuration * 1000) / totalChars;

  const dialogues = [];
  let charIndex = 0;

  // Xử lý từng dòng
  lines.forEach((lineWords, lineIndex) => {
    // Tính chiều rộng của dòng hiện tại
    const lineWidth = lineWords.reduce((width, word, i) => {
      return width + (word.length - 1) * charSpacing + (i < lineWords.length - 1 ? wordSpacing : 0);
    }, 0);

    let currentX = centerX - (lineWidth / 2);
    const currentY = baseY + (lineIndex * lineHeight);

    // Xử lý từng từ trong dòng
    lineWords.forEach((word, wordIndex) => {
      const chars = word.split('');
      
      chars.forEach((char, charIndexInWord) => {
        const charStart = formatAssTime(startTime + (charIndex * charDuration) / 1000);
        const charEnd = formatAssTime(endTime);
        
        const charX = currentX + charIndexInWord * charSpacing;
        
        const charEffect = `\\fad(200,1500)\\pos(${charX},${currentY})\\an5\\t(0,200,\\fscx110\\fscy110\\1c${startColor}\\3c${startOutline})\\t(200,400,\\fscx100\\fscy100\\1c${endColor}\\3c${endOutline})`;
        
        dialogues.push(`Dialogue: 0,${charStart},${charEnd},Title,,0,0,0,,{${charEffect}}${char}`);
        charIndex++;
      });
      
      currentX += (chars.length - 1) * charSpacing + wordSpacing;
    });
  });

  return dialogues.join('\n');
}

/**
 * Tạo file ASS kết hợp tiêu đề và phụ đề gốc
 */
async function createCombinedAss(subtitlePath, titleText, outputDir, taskId) {
  const logPrefix = taskId ? `[Task ${taskId}]` : '';
  
  try {
    // Đọc nội dung gốc
    const originalContent = fs.readFileSync(subtitlePath, 'utf8');
    
    // Phân tích cấu trúc file ASS bằng cách tìm các section header
    const sections = {};
    let currentSection = null;
    let sectionContent = '';
    
    // Tách file thành các section
    const lines = originalContent.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      // Kiểm tra xem dòng có phải là section header không
      if (line.match(/^\[.*\]$/)) {
        // Lưu section trước đó nếu có
        if (currentSection) {
          sections[currentSection] = sectionContent;
        }
        
        // Bắt đầu section mới
        currentSection = line;
        sectionContent = line + '\n';
      } else if (currentSection) {
        // Bỏ qua dòng "Style: Title" trong Script Info nếu có
        if (currentSection === '[Script Info]' && line.trim().startsWith('Style: Title,')) {
          continue;
        }
        sectionContent += line + '\n';
      }
    }
    
    // Lưu section cuối cùng
    if (currentSection) {
      sections[currentSection] = sectionContent;
    }
    
    // Đảm bảo các section cần thiết tồn tại
    if (!sections['[Script Info]']) {
      throw new Error('File ASS không hợp lệ: không tìm thấy phần [Script Info]');
    }
    
    if (!sections['[V4+ Styles]']) {
      sections['[V4+ Styles]'] = '[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n';
    }
    
    if (!sections['[Events]']) {
      throw new Error('File ASS không hợp lệ: không tìm thấy phần [Events]');
    }
    
    // Thêm style Title vào phần [V4+ Styles]
    const titleStyle = 'Style: Title,Bungee Spice,256,&H000000FF,&H00FFFFFF,&H0000E4FF,&H00FFFFFF,-1,0,0,0,110,100,1,0,1,2,2,5,10,10,10,163\n';
    
    // Kiểm tra xem style Title đã tồn tại chưa
    if (!sections['[V4+ Styles]'].includes('Style: Title,')) {
      // Tìm vị trí sau dòng Format
      const formatIndex = sections['[V4+ Styles]'].indexOf('Format:');
      if (formatIndex !== -1) {
        const afterFormatIndex = sections['[V4+ Styles]'].indexOf('\n', formatIndex) + 1;
        sections['[V4+ Styles]'] = 
          sections['[V4+ Styles]'].slice(0, afterFormatIndex) + 
          titleStyle + 
          sections['[V4+ Styles]'].slice(afterFormatIndex);
      } else {
        // Nếu không có dòng Format, thêm vào cuối
        sections['[V4+ Styles]'] += 'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n' + titleStyle;
      }
    }
    
    // Thêm dialogue tiêu đề vào phần [Events]
    const titleDialogue = createTitleWithEffect(titleText);
    
    // Kiểm tra xem đã có dialogue tiêu đề chưa
    const hasExistingTitle = sections['[Events]'].includes('Title,,0,0,0,,{\\fad') || 
                            sections['[Events]'].includes('\\move') && sections['[Events]'].includes(titleText);
    
    if (!hasExistingTitle) {
      // Tìm vị trí sau dòng Format
      const formatIndex = sections['[Events]'].indexOf('Format:');
      if (formatIndex !== -1) {
        const afterFormatIndex = sections['[Events]'].indexOf('\n', formatIndex) + 1;
        sections['[Events]'] = 
          sections['[Events]'].slice(0, afterFormatIndex) + 
          titleDialogue + '\n' + 
          sections['[Events]'].slice(afterFormatIndex);
      } else {
        throw new Error('File ASS không hợp lệ: không tìm thấy dòng Format trong phần Events');
      }
    }
    
    // Ghép các section lại thành file mới
    // Thứ tự: Script Info -> Aegisub Project Garbage (nếu có) -> V4+ Styles -> Events
    let newContent = sections['[Script Info]'];
    
    if (sections['[Aegisub Project Garbage]']) {
      newContent += sections['[Aegisub Project Garbage]'];
    }
    
    newContent += sections['[V4+ Styles]'] + sections['[Events]'];
    
    // Lưu file mới
    const newPath = path.join(outputDir, `combined_${path.basename(subtitlePath)}`);
    fs.writeFileSync(newPath, newContent);
    
    // KIỂM TRA: Sao chép file ASS ra thư mục output để kiểm tra
    // TODO: Xóa đoạn code này sau khi đã kiểm tra xong
    try {
      const outputAssPath = path.join('output', `debug_${taskId}_${path.basename(subtitlePath)}`);
      await ensureDir(path.dirname(outputAssPath));
      fs.copyFileSync(newPath, outputAssPath);
      logger.info(`${logPrefix} Đã sao chép file ASS để kiểm tra tại: ${outputAssPath}`, 'SubtitleProcessor');
      
      // Ghi thêm file gốc để so sánh
      const originalOutputPath = path.join('output', `original_${taskId}_${path.basename(subtitlePath)}`);
      fs.copyFileSync(subtitlePath, originalOutputPath);
      logger.info(`${logPrefix} Đã sao chép file ASS gốc để so sánh tại: ${originalOutputPath}`, 'SubtitleProcessor');
    } catch (copyError) {
      logger.warn(`${logPrefix} Không thể sao chép file ASS để kiểm tra: ${copyError.message}`, 'SubtitleProcessor');
    }
    
    logger.info(`${logPrefix} Đã thêm tiêu đề và giữ nguyên tất cả dialogue gốc`, 'SubtitleProcessor');
    return newPath;
  } catch (error) {
    logger.error(`${logPrefix} Lỗi tạo tiêu đề: ${error.message}`, 'SubtitleProcessor');
    throw error;
  }
}

export {
  processAssSubtitle,
  createCombinedAss,
  createTitleWithEffect
}; 