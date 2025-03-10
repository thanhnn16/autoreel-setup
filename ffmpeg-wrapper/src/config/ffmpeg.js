/**
 * Cấu hình cho FFmpeg và FFprobe
 */

export default {
  // Đường dẫn đến FFmpeg và FFprobe
  ffmpegPath: 'ffmpeg',
  ffprobePath: 'ffprobe',
  
  // Cấu hình mặc định cho video
  video: {
    codec: 'libx264',
    preset: 'medium',
    crf: 23,
    pixFmt: 'yuv420p',
    frameRate: 30,
  },
  
  // Cấu hình mặc định cho audio
  audio: {
    codec: 'aac',
    bitrate: '128k',
    sampleRate: 44100,
    channels: 2,
  },
  
  // Cấu hình cho subtitle
  subtitle: {
    fontName: 'Arial',
    fontSize: 24,
    primaryColor: 'white',
    outlineColor: 'black',
    outlineWidth: 1,
  },
  
  // Cấu hình cho slideshow
  slideshow: {
    transitionDuration: 1,
    defaultImageDuration: 5,
  },
}; 