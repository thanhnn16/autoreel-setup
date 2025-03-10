/**
 * Thiết lập alias cho dự án
 * Lưu ý: Bun không hỗ trợ module-alias như Node.js
 * Chúng ta sẽ sử dụng cách tiếp cận khác
 */
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';

// Lấy đường dẫn hiện tại
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = resolve(__dirname, '../..');

// Định nghĩa các đường dẫn tuyệt đối
export const paths = {
  root: rootDir,
  src: join(rootDir, 'src'),
  config: join(rootDir, 'src/config'),
  services: join(rootDir, 'src/services'),
  utils: join(rootDir, 'src/utils'),
  routes: join(rootDir, 'src/routes')
};

export default paths; 