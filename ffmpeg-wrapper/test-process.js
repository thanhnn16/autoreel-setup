import fs from 'fs';
import fetch from 'node-fetch';

// Đọc dữ liệu từ file data.json
const data = JSON.parse(fs.readFileSync('./mock/data.json', 'utf8'));

console.log('Dữ liệu đầu vào:');
console.log(JSON.stringify(data, null, 2));

// Gửi request đến endpoint /process
async function sendRequest() {
  try {
    console.log('Đang gửi request đến http://localhost:3000/process...');
    
    const response = await fetch('http://localhost:3000/process', {
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