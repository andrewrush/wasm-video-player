# 🎬 WASM Video Player

Универсальный видеоплеер в браузере с FFmpeg WASM.

## Быстрый старт

```bash
cd ~
mkdir -p wasm-video-player && cd wasm-video-player
unzip -o ~/downloads/wasm-video-player.zip -d .

# Скачать FFmpeg WASM файлы (~30MB)
bash download-ffmpeg.sh

# Или вручную:
# mkdir -p js/ffmpeg
# curl -L -o js/ffmpeg/ffmpeg.js https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/dist/umd/ffmpeg.js
# curl -L -o js/ffmpeg/ffmpeg-core.js https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.js
# curl -L -o js/ffmpeg/ffmpeg-core.wasm https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.wasm

git init
git branch -M main
git add .
git commit -m "init: wasm video player"
gh repo create andrewrush/wasm-video-player --public --source=. --push

# Включить Pages (если ещё не включено)
gh api repos/andrewrush/wasm-video-player/pages -X POST -F "build_type=workflow"
```

## Обновление из архива

```bash
cd ~/wasm-video-player
unzip -o ~/downloads/wasm-video-player.zip -d .
git add .
git commit -m "update: unpack archive"
git push
```

## Архитектура

- HTML5 Video для MP4/H.264
- FFmpeg WASM (self-hosted) для MKV/HEVC/AVI/MOV
- Автотранскодирование при загрузке неподдерживаемого формата
