FROM node:20-slim

# System deps: ffmpeg + python3 + pip + curl
RUN apt-get update && apt-get install -y \
    ffmpeg \
    python3 \
    python3-pip \
    curl \
    wget \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# yt-dlp install
RUN pip3 install yt-dlp --break-system-packages

# Verify installs
RUN ffmpeg -version 2>&1 | head -1
RUN yt-dlp --version

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

EXPOSE 8080

CMD ["node", "src/server.js"]
