import fs from 'fs';
import fetch from 'node-fetch';

// Đọc dữ liệu từ file data.json
const data = JSON.parse(fs.readFileSync('./mock/data.json', 'utf8'));

// Lấy argument từ command line
const env = process.argv[2] || 'local';

// Set endpoint URL dựa trên môi trường
const ENDPOINTS = {
  local: 'http://localhost:3000/api/process/task',
  prod: 'http://n8n.autoreel.io.vn:3000/api/process/task'
};

const apiUrl = ENDPOINTS[env];
if (!apiUrl) {
  console.error('Môi trường không hợp lệ. Sử dụng: node test-process.js [local|prod]');
  process.exit(1);
}

console.log('Dữ liệu đầu vào:');
console.log(JSON.stringify(data, null, 2));

// Gửi request đến endpoint /process
async function sendRequest() {
  try {
    console.log(`Đang gửi request đến ${apiUrl}...`);
    
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(data)
    });
    
    const result = await response.json();
    
    console.log('Kết quả:');
    console.log(JSON.stringify(result, null, 2));
    
    return result;
  } catch (error) {
    console.error('Lỗi khi gửi request:', error);
    throw error;
  }
}

sendRequest().catch(console.error); 