#!/data/data/com.termux/files/usr/bin/bash
# Скачивает FFmpeg WASM файлы для self-hosted режима
# Запускать из папки проекта: bash download-ffmpeg.sh

set -e

echo "📥 Скачивание FFmpeg WASM файлов..."
mkdir -p js/ffmpeg

curl -L -o js/ffmpeg/ffmpeg.js https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/dist/umd/ffmpeg.js

curl -L -o js/ffmpeg/ffmpeg-core.js https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.js

curl -L -o js/ffmpeg/ffmpeg-core.wasm https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.wasm

# Worker-файл обязателен для UMD-сборки (ffmpeg.js создает Web Worker)
curl -L -o js/ffmpeg/814.ffmpeg.js https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/dist/umd/814.ffmpeg.js

echo "✅ Готово. Файлы в js/ffmpeg/"
echo "📋 Теперь выполни: git add js/ffmpeg && git commit -m 'add: ffmpeg wasm' && git push"
