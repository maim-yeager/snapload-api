$)C# SnapLoad API

Social Media Downloader API  YouTube, TikTok, Instagram, Facebook  
Powered by yt-dlp + ffmpeg. Hosted on Fly.io.

---

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Server status |
| POST | `/extract` | Get metadata + format list |
| GET | `/download?url=&quality=` | Download merged mp4 with audio |

### POST /extract
```json
{ "url": "https://www.youtube.com/watch?v=..." }
```

### GET /download
```
/download?url=VIDEO_URL&quality=best
/download?url=VIDEO_URL&quality=720p
/download?url=VIDEO_URL&quality=audio
```
Quality options: `best` | `360p` | `720p` | `1080p` | `audio`

---

## Deploy on Fly.io (Step by Step)

### 1. Install Fly CLI

**Windows (PowerShell):**
```powershell
powershell -ExecutionPolicy ByPass -c "irm https://fly.io/install.ps1 | iex"
```

**Mac:**
```bash
brew install flyctl
```

**Linux:**
```bash
curl -L https://fly.io/install.sh | sh
```

### 2. Login
```bash
fly auth login
```

### 3. Create app (only first time)
```bash
fly apps create snapload-api
```
>   taken     , fly.toml    

### 4. Deploy
```bash
fly deploy
```

### 5. Check status
```bash
fly status
fly logs
```

### 6. Open in browser
```bash
fly open
```

---

## Update  

Code change  :
```bash
fly deploy
```

---

## Local   

```bash
# Requirements
pip install yt-dlp
# ffmpeg install (Ubuntu/Debian)
sudo apt install ffmpeg
# ffmpeg install (Mac)
brew install ffmpeg

npm install
npm start
```

---

## Supported Platforms

- YouTube (video + playlist)
- TikTok
- Instagram (post, reel, story)
- Facebook (video, reel)
##Devoloper info

- Name : Maim islam
- Religion : Muslim 
- Age :19
- Blood Group :B+
- Study : Depolma engineer
- Status : Single
- Im Cyber Exparte 
