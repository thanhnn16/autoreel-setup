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
  const { taskId } = options;
  const logPrefix = taskId ? `[Task ${taskId}]` : '';
  
  try {
    logger.info(`${logPrefix} Bắt đầu tải phụ đề từ ${subtitleUrl}`, 'SubtitleProcessor');
    
    // Tạo tên file
    const subtitleFilename = `subtitle_${taskId || Date.now()}.ass`;
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
function createTitleWithEffect(titleText, duration = 3) {
  const startTime = 0;
  const endTime = startTime + duration;
  
  // Hiệu ứng fade in + di chuyển từ dưới lên cho video dọc 1080x1920
  // Đảm bảo tiêu đề hiển thị ở giữa màn hình
  const videoWidth = 1080;
  const videoHeight = 1920;
  const centerX = videoWidth / 2;
  const startY = videoHeight + 100;
  const endY = videoHeight * 0.75; // Vị trí kết thúc ở 3/4 chiều cao màn hình
  
  const effect = `\\fad(800,200)\\move(${centerX},${startY},${centerX},${endY})\\blur5\\t(0,500,\\blur0)\\c&HFFFFFF&\\3c&H0000FF&`;

  return `Dialogue: 0,${formatAssTime(startTime)},${formatAssTime(endTime)},Title,,0,0,0,,{${effect}}${titleText}`;
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
    const titleStyle = 'Style: Title,Bungee Spice,124,&H000000FF,&H00FFFFFF,&H0000E4FF,&H00FFFFFF,-1,0,0,0,110,100,1,0,1,2,2,5,10,10,10,163\n';
    
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
  createCombinedAss
}; 