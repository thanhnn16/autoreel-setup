FROM linuxserver/ffmpeg:latest

USER root

# Update package list and install Node.js and npm (for Debian/Ubuntu)
RUN apt-get update && \
    apt-get install -y nodejs npm && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Override the base image's ENTRYPOINT
ENTRYPOINT []

# Copy package.json and install dependencies
COPY package.json .
RUN npm install

# Copy server source code
COPY server.js .

# Expose port for HTTP server
EXPOSE 3000

# Start the server
CMD ["node", "server.js"]
