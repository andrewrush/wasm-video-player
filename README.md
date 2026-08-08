# 🎬 WASM Video Player

**Универсальный видеоплеер в браузере: MKV, HEVC, AVI, MOV, WebM, MP4 — всё через FFmpeg WASM + HTML5 fallback.**

> Вдохновлено проектом **[movi-player](https://github.com/mrujjwalg/movi-player)** — modern modular video player powered by WebCodecs + FFmpeg WASM.

## Архитектура

```
┌─────────────────────────────────────────────────────────────┐
│              Пользователь загружает видео-файл              │
│                   (drag & drop / выбор)                     │
└─────────────────────────────────────────────────────────────┘
                              │
                    ┌─────────┴─────────┐
                    ▼                   ▼
           ┌──────────────┐    ┌──────────────────┐
           │ HTML5 Video  │    │  FFmpeg WASM     │
           │ Поддерживает?│    │  Транскодирование│
           │  (MP4/H.264) │    │  MKV→MP4         │
           │              │    │  HEVC→H.264      │
           │  ДА → Play   │    │  AVI→MP4         │
           │              │    │  MOV→MP4         │
           └──────────────┘    │  и др.           │
                               │                  │
                               │  Результат →     │
                               │  Blob URL →      │
                               │  HTML5 Video     │
                               └──────────────────┘
```

## Возможности

| Функция | Описание |
|---------|----------|
| **Автоопределение формата** | Если браузер не умеет формат — автотранскод в MP4 (H.264/AAC) |
| **MKV / HEVC / AVI / MOV** | Воспроизведение через FFmpeg WASM прямо в браузере |
| **HTML5 fallback** | MP4/H.264 проигрывается нативно, без задержек |
| **Nerd Stats** | Кодек, разрешение, FPS, битрейт, длительность |
| **Скриншоты** | Извлечение 8 кадров из видео |
| **GIF** | Создание анимированного GIF (3 сек) |
| **Инфо** | Полный вывод `ffmpeg -i` |
| **Drag & Drop** | Загрузка файла перетаскиванием |

## Почему FFmpeg WASM?

Браузер нативно не умеет:
- **MKV** (Matroska)
- **HEVC / H.265**
- **AVI**
- **MOV** (некоторые кодеки)
- **AV1** (не везде)
- **MPEG-2**

FFmpeg WASM транскодирует файл в браузере в **MP4 (H.264 + AAC)**, который понимает любой браузер. Никакого сервера — всё на клиенте.

> Single-thread версия FFmpeg WASM не требует `SharedArrayBuffer` и заголовков COOP/COEP. Работает на GitHub Pages из коробки.

## Быстрый старт (Termux)

```bash
# 1. Перейти в домашний каталог
cd ~

# 2. Создать папку проекта
mkdir -p wasm-video-player && cd wasm-video-player

# 3. Распаковать архив из ~/downloads/ в текущую папку
unzip -o ~/downloads/wasm-video-player.zip -d .

# 4. Инициализировать git
git init
git branch -M main
git add .
git commit -m "init: wasm video player"

# 5. Создать репозиторий на GitHub и запушить
gh repo create andrewrush/wasm-video-player --public --source=. --push

# 6. В настройках репозитория включить GitHub Actions
#    Settings → Pages → Source: GitHub Actions
```

## Обновление из архива

```bash
# Перейти в папку проекта
cd ~/wasm-video-player

# Распаковать новый архив из ~/downloads/ в текущую папку
unzip -o ~/downloads/wasm-video-player-update.zip -d .

# Или если .tar.gz:
# tar -xzf ~/downloads/wasm-video-player-update.tar.gz -C . --overwrite

# Закоммитить и запушить
git add .
git commit -m "update: unpack from archive"
git push
```

## Структура

```
wasm-video-player/
├── index.html              # UI: плеер, drag&drop, stats
├── css/
│   └── style.css           # Тёмная тема, адаптив
├── js/
│   └── app.js              # Логика: HTML5 detect → FFmpeg transcode
├── .github/
│   └── workflows/
│       └── deploy.yml      # CI/CD GitHub Actions
├── README.md
└── .gitignore
```

## FFmpeg WASM

- **ffmpeg.js**: `https://unpkg.com/@ffmpeg/ffmpeg@0.12.10/dist/umd/ffmpeg.js`
- **core + wasm**: `https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.*`

Single-thread, Asyncify I/O — работает без `SharedArrayBuffer`.

## Fallback

1. **WASM загрузился** → автоопределение формата, транскод при необходимости
2. **WASM не загрузился** → только HTML5 video (MP4/H.264)
3. **Старый браузер** → HTML5 video элемент поддерживается везде

## Референсы

- **[movi-player](https://github.com/mrujjwalg/movi-player)** — вдохновение для архитектуры (Canvas rendering, HDR, WebCodecs, zero-copy streaming)
- **[ffmpeg.wasm](https://github.com/ffmpegwasm/ffmpeg.wasm)** — FFmpeg порт в WebAssembly

## Лицензия

MIT
