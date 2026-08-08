# 🎬 WASM Video Player

Универсальный видеоплеер в браузере с FFmpeg WASM + WebGL фильтры.

## Что нового в этой версии

- **Lazy Loading FFmpeg** — 32MB WASM не грузится сразу, только по кнопке/требованию
- **Прогресс загрузки с МБ** — видно сколько скачано из 32MB
- **WebGL Post-Processing** — 7 фильтров: Ч/Б, сепия, инверт, винтаж, контуры, пиксели, блюр
- **Service Worker** — кеширование статики и WASM
- **Fallback** — HTML5 Video работает всегда для MP4

## Быстрый старт (Termux)

```bash
cd ~
mkdir -p wasm-video-player && cd wasm-video-player
unzip -o ~/downloads/wasm-video-player.zip -d .

# Скачать FFmpeg WASM (~32MB)
bash download-ffmpeg.sh

git init
git branch -M main
git add .
git commit -m "init: wasm video player v2"
gh repo create andrewrush/wasm-video-player --public --source=. --push

# Включить Pages
gh api repos/andrewrush/wasm-video-player/pages -X POST -F "build_type=workflow"
```

## Обновление из архива

```bash
cd ~/wasm-video-player
unzip -o ~/downloads/wasm-video-player.zip -d .
git add .
git commit -m "update: unpack archive v2"
git push
```

## Архитектура

- HTML5 Video для MP4/H.264 (мгновенно)
- FFmpeg WASM (lazy-load) для MKV/HEVC/AVI/MOV
- WebGL Canvas для пост-обработки видео
- Service Worker для кеширования
