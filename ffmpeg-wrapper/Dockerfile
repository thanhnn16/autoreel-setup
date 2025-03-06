FROM node:18-alpine

# Cài đặt ffmpeg qua apk
RUN apk add --no-cache ffmpeg

WORKDIR /app
COPY package*.json ./
RUN npm init -y && npm install express
COPY . .

EXPOSE 3000
CMD ["node", "index.js"]
