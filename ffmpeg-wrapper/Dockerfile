FROM linuxserver/ffmpeg:latest

USER root

# Install curl and unzip for Bun installation
RUN apt-get update && \
    apt-get install -y curl unzip && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Install Bun
RUN curl -fsSL https://bun.sh/install | bash

# Add Bun to PATH
ENV PATH="/root/.bun/bin:${PATH}"

WORKDIR /app

# Override the base image's ENTRYPOINT
ENTRYPOINT []

# Copy package.json and bun.lock, then install dependencies
COPY package.json bun.lock ./
RUN bun install

# Copy source code
COPY src/ ./src/

# Expose port for HTTP server
EXPOSE 3000

# Start the server
CMD ["bun", "src/app.js"]
