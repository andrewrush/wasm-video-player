# WASM Video Player

Универсальный браузерный видеоплеер на FFmpeg WASM. Поддерживает MKV, HEVC, AVI, MOV, WebM, MP4 и другие форматы через транскодирование прямо в браузере.

🌐 **Живой сайт:** [https://andrewrush.github.io/wasm-video-player/](https://andrewrush.github.io/wasm-video-player/)

## Возможности

- 🎬 **Воспроизведение** любых видеоформатов через FFmpeg WASM
- 🔄 **Авто-Fallback** — пробуем HTML5 для всех файлов, при ошибке декодера → FFmpeg
- 🖼 **Скриншоты** — извлечение кадров из видео
- 🎞 **GIF** — создание анимированных превью
- 📋 **Информация** о кодеках, разрешении, битрейте
- 🎨 **WebGL-фильтры** — Ч/Б, сепия, инверт, винтаж, контуры, пиксели, блюр
- 📱 **PWA** — работает офлайн через Service Worker
- ⚡ **Eager Load** — FFmpeg загружается сразу при открытии страницы
- 📦 **Streaming** — для файлов > 64MB используется MSE-стриминг по чанкам
- 📝 **Полное логирование** — каждый шаг streaming pipeline виден в консоли и UI

## Как это работает

1. **Загрузка файла** — пробуем открыть в HTML5 `<video>` для ЛЮБОГО формата
2. **Ошибка декодера?** — показываем overlay «Попробовать FFmpeg» прямо на плеере
3. **FFmpeg fallback** — транскод в H.264/AAC через WASM
4. **Большие файлы (> 64 МБ)** — чанкованный стриминг (MSE) с ограниченной памятью
5. **Маленькие файлы** — полный legacy-транскод

## Streaming Pipeline (v15-log)

- **Вход:** файл монтируется в FFmpeg FS
- **Обработка:** файл нарезается на чанки по 10 секунд, каждый чанк обрабатывается отдельным `exec`
- **Выход:** фрагментированный MP4 (frag_keyframe+empty_moov+default_base_moof) подаётся в MediaSource Extensions (MSE)
- **Логирование:** каждый шаг (`sourceopen`, `addSourceBuffer`, `exec`, `readFile`, `split`, `appendBuffer`, `timestampOffset`) логируется в консоль и UI-панель
- **Split:** init-сегмент (ftyp+moov) отделяется от media (moof+mdat) перед подачей в MSE

### Ограничения

- Транскод медленнее realtime (однопоточный WASM без SharedArrayBuffer)
- Прерывание обработки происходит между чанками (exec нельзя прервать на лету)
- GitHub Pages не даёт заголовки COOP/COEP → только однопоточное ядро

## Стек

- `@ffmpeg/ffmpeg` 0.12.x (UMD, самохостинг)
- Emscripten однопоточное ядро (без SharedArrayBuffer)
- MediaSource Extensions (MSE)
- WebGL 2.0 для фильтров
- Service Worker для офлайн-кеша

## Локальная разработка (Termux)

```bash
cd ~/wasm-video-player
python3 -m http.server 8080
# Открыть http://127.0.0.1:8080
```

## Лицензия

MIT
