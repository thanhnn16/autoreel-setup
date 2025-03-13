/**
 * Cấu hình cho FFmpeg và FFprobe
 */

export default {
  // Đường dẫn đến FFmpeg và FFprobe
  ffmpegPath: 'ffmpeg',
  ffprobePath: 'ffprobe',
  
  // Thời gian timeout
  timeout: 20 * 60 * 1000, // 20 phút cho FFmpeg
  probeTimeout: 60 * 1000, // 1 phút cho FFprobe
  
  // Cấu hình mặc định cho video
  video: {
    codec: 'libx264',
    preset: 'slow',
    crf: 18,
    pixFmt: 'yuv420p',
    frameRate: 30,
    width: 1080,
    height: 1920,
    gopSize: 30,
    bitrate: '7M',
    maxZoom: 1.15,
    zoomSpeed: 0.0004,
    largeScale: 3000,
  },
  
  // Cấu hình mặc định cho audio
  audio: {
    codec: 'aac',
    bitrate: '128k',
    sampleRate: 44100,
    channels: 2,
    mixing: {
      voiceVolume: 1,
      bgVolume: 0.05,
      sidechain: {
        threshold: 0.02,
        ratio: 5,
        attack: 5,
        release: 50
      },
      dynaudnorm: {
        framelen: 200,
        maxGain: 15,
        targetRms: -18
      }
    }
  },
  
  // Cấu hình cho slideshow
  slideshow: {
    transitionDuration: 1,
    defaultImageDuration: 5,
  },
  
  // Cấu hình hiệu ứng
  effects: {
    // Thời gian chuyển cảnh (giây)
    transitionDuration: 0.3,
    
    // Danh sách hiệu ứng chuyển cảnh
    transitions: [
      'fade',
      'fadeblack', 
      'fadewhite',
      'distance',
      'circleclose',
      'circleopen',
      'horzclose',
      'horzopen',
      'vertclose',
      'vertopen',
      'diagbl',
      'diagbr',
      'diagtl',
      'diagtr',
      'dissolve',
      'pixelize',
      'hblur',
      'fadegrays',
      'zoomin'
    ],
    
    // Các kiểu zoom và pan
    kenBurns: {
      // Zoom vào trung tâm
      zoomIn: {
        scale: 'min(1+(on/{frames})*0.1,1.1)',
        x: 'iw/2-(iw/zoom/2)',
        y: 'ih/2-(ih/zoom/2)'
      },
      
      // Pan từ trái sang phải
      panRight: {
        scale: '1.05',
        x: 'max(0,min((iw-iw/zoom)*((on)/{frames}),iw))',
        y: 'ih/2-(ih/zoom/2)'
      },
      
      // Pan từ trên xuống
      panDown: {
        scale: '1.05', 
        x: 'iw/2-(iw/zoom/2)',
        y: 'max(0,min((ih-ih/zoom)*((on)/{frames}),ih))'
      },
      
      // Zoom out
      zoomOut: {
        scale: 'max(1.1-(on/{frames})*0.08,1.02)',
        x: 'iw/2-(iw/zoom/2)',
        y: 'ih/2-(ih/zoom/2)'
      }
    }
  },
  
  title: {
    duration: 3, // Thời lượng hiển thị
    effects: {
      fadeInDuration: 0.5, // Giây
      moveOffset: 100 // Pixel di chuyển
    }
  }
}; 