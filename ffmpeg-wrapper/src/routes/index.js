/**
 * Quản lý các routes
 */
import express from 'express';
import processRoutes from './process.js';
import logsRoutes from './logs.js';

const router = express.Router();

// Thêm các routes
router.use('/process', processRoutes);
router.use('/logs', logsRoutes);

// Route mặc định
router.get('/', (req, res) => {
  res.json({
    status: 'ok',
    message: 'FFmpeg Wrapper API',
    version: '1.0.0',
    endpoints: [
      '/process',
      '/logs'
    ]
  });
});

export default router; 