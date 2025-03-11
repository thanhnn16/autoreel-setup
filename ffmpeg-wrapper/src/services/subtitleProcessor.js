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
  
  // Hiệu ứng fade in + di chuyển từ dưới lên
  const effect = `\\fad(500,0)\\move(${ffmpegConfig.video.width / 2},${ffmpegConfig.video.height + 100},${ffmpegConfig.video.width / 2},${ffmpegConfig.video.height - 150})`;

  return `Dialogue: 0,${formatAssTime(startTime)},${formatAssTime(endTime)},Title,,0,0,0,,{${effect}}${titleText}`;
}

/**
 * Tạo file ASS kết hợp tiêu đề và phụ đề gốc
 */
async function createCombinedAss(subtitlePath, titleText, outputDir, taskId) {
  const logPrefix = taskId ? `[Task ${taskId}]` : '';
  
  try {
    const originalContent = fs.readFileSync(subtitlePath, 'utf8');
    
    // Tìm vị trí các phần quan trọng
    const stylesSectionIndex = originalContent.indexOf('[V4+ Styles]');
    const eventsSectionIndex = originalContent.indexOf('[Events]');
    
    if (eventsSectionIndex === -1) throw new Error('File ASS không hợp lệ: không tìm thấy phần [Events]');
    
    let newContent = originalContent;
    
    // 1. Thêm style Title vào phần [V4+ Styles]
    const titleStyle = '\nStyle: Title,Bungee Spice,82,&H000000FF,&H00FFFFFF,&H0000E4FF,&H00FFFFFF,-1,0,0,0,110,100,1,0,1,2,2,5,10,10,10,163';
    
    if (stylesSectionIndex !== -1) {
      // Chèn style vào cuối phần Styles
      const endStylesIndex = originalContent.indexOf('\n', originalContent.lastIndexOf('Style:', stylesSectionIndex));
      newContent = originalContent.slice(0, endStylesIndex) + 
                  titleStyle + 
                  originalContent.slice(endStylesIndex);
    } else {
      // Tạo mới phần Styles nếu không tồn tại
      const stylesSection = `\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding${titleStyle}\n`;
      newContent = originalContent.slice(0, eventsSectionIndex) + 
                  stylesSection + 
                  originalContent.slice(eventsSectionIndex);
    }

    // 2. Chèn dialogue tiêu đề vào đầu phần Events
    const eventsHeader = '[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n';
    const eventsContentIndex = newContent.indexOf(eventsHeader) + eventsHeader.length;
    
    const titleDialogue = createTitleWithEffect(titleText);
    newContent = newContent.slice(0, eventsContentIndex) + 
                titleDialogue + '\n' + 
                newContent.slice(eventsContentIndex);

    // Lưu file mới
    const newPath = path.join(outputDir, `combined_${path.basename(subtitlePath)}`);
    fs.writeFileSync(newPath, newContent);
    
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