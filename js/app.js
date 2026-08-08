/**
 * WASM Video Player
 * FFmpeg WASM (single-thread CDN) + HTML5 Video fallback
 * Воспроизведение MKV/HEVC/AVI/MOV через транскодирование в MP4
 *
 * Вдохновлено: https://github.com/mrujjwalg/movi-player
 * Окружение: GitHub Pages, Termux Android aarch64
 */

const $ = (sel) => document.querySelector(sel);

// ===== Состояние =====
const state = {
    ffmpeg: null,
    ffmpegReady: false,
    currentFile: null,
    currentFileName: '',
    currentFileData: null,
    isTranscoded: false,
    transcodedBlobUrl: null,
};

// ===== DOM элементы =====
const els = {
    status: $('#status-bar'),
    dropZone: $('#drop-zone'),
    fileInput: $('#file-input'),
    video: $('#video-player'),
    placeholder: $('#placeholder'),
    statsPanel: $('#stats-panel'),
    statsGrid: $('#stats-grid'),
    ffmpegPanel: $('#ffmpeg-panel'),
    btnTranscode: $('#btn-transcode'),
    btnThumbs: $('#btn-thumbs'),
    btnGif: $('#btn-gif'),
    btnInfo: $('#btn-info'),
    progress: $('#progress'),
    progressFill: $('#progress-fill'),
    progressText: $('#progress-text'),
    logOutput: $('#log-output'),
    resultPanel: $('#result-panel'),
    resultContent: $('#result-content'),
    thumbsPanel: $('#thumbs-panel'),
    thumbsGrid: $('#thumbs-grid'),
};

// ===== Форматы, которые HTML5 обычно НЕ поддерживает =====
const NEEDS_TRANSCODE_EXTS = new Set([
    '.mkv', '.avi', '.mov', '.flv', '.wmv', '.m2ts', '.ts',
    '.mpeg', '.mpg', '.3gp', '.ogv', '.webm',  // webm частично, но на всякий
]);

const NEEDS_TRANSCODE_CODECS = ['hevc', 'h265', 'av1', 'vp9', 'mpeg2', 'mpeg4'];

// ===== Инициализация =====
async function init() {
    setStatus('loading', 'Загрузка FFmpeg WASM...');

    const wasmSupported = typeof WebAssembly === 'object' &&
                          typeof WebAssembly.instantiate === 'function';

    if (!wasmSupported) {
        setStatus('fallback', '⚡ HTML5 режим (WASM не поддерживается) — MKV/HEVC не будут работать');
        showFallback();
        return;
    }

    try {
        const { FFmpeg } = FFmpegWASM;
        state.ffmpeg = new FFmpeg();

        state.ffmpeg.on('log', ({ message }) => appendLog(message));
        state.ffmpeg.on('progress', ({ progress }) => {
            updateProgress(Math.round(progress * 100));
        });

        await state.ffmpeg.load({
            coreURL: 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.js',
            wasmURL: 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.wasm'
        });

        state.ffmpegReady = true;
        setStatus('ready', '✅ FFmpeg WASM готов — MKV/HEVC/AVI теперь playable');
        els.ffmpegPanel.style.display = 'block';
    } catch (err) {
        console.error('FFmpeg load error:', err);
        setStatus('fallback', '⚡ HTML5 режим (FFmpeg WASM недоступен) — MKV/HEVC не будут работать');
        showFallback();
    }

    setupEvents();
}

function showFallback() {
    els.ffmpegPanel.style.display = 'none';
    enableButtons(false);
}

function setStatus(cls, text) {
    els.status.className = 'status ' + cls;
    els.status.textContent = text;
}

function enableButtons(enabled) {
    [els.btnTranscode, els.btnThumbs, els.btnGif, els.btnInfo].forEach(btn => {
        btn.disabled = !enabled || !state.currentFile;
    });
}

function appendLog(msg) {
    els.logOutput.textContent += msg + '\n';
    els.logOutput.scrollTop = els.logOutput.scrollHeight;
}

function updateProgress(pct) {
    els.progress.style.display = 'flex';
    els.progressFill.style.width = pct + '%';
    els.progressText.textContent = pct + '%';
}

function resetProgress() {
    els.progress.style.display = 'none';
    els.progressFill.style.width = '0%';
    els.progressText.textContent = '0%';
}

// ===== События =====
function setupEvents() {
    els.dropZone.addEventListener('click', () => els.fileInput.click());
    els.fileInput.addEventListener('change', (e) => handleFile(e.target.files[0]));

    els.dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        els.dropZone.classList.add('dragover');
    });
    els.dropZone.addEventListener('dragleave', () => {
        els.dropZone.classList.remove('dragover');
    });
    els.dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        els.dropZone.classList.remove('dragover');
        const file = e.dataTransfer.files[0];
        if (file && file.type.startsWith('video/')) handleFile(file);
    });

    els.btnTranscode.addEventListener('click', transcodeToMp4);
    els.btnThumbs.addEventListener('click', extractThumbnails);
    els.btnGif.addEventListener('click', makeGif);
    els.btnInfo.addEventListener('click', getFfmpegInfo);
}

// ===== Утилиты =====
function formatBytes(b) {
    if (b === 0) return '0 B';
    const k = 1024;
    const sizes = ['B','KB','MB','GB'];
    const i = Math.floor(Math.log(b) / Math.log(k));
    return parseFloat((b / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function ext(name) {
    const i = name.lastIndexOf('.');
    return i >= 0 ? name.slice(i).toLowerCase() : '.mp4';
}

function basename(name) {
    const i = name.lastIndexOf('.');
    return i >= 0 ? name.slice(0, i) : name;
}

function needsTranscode(file) {
    const e = ext(file.name);
    const type = file.type.toLowerCase();

    // По расширению
    if (NEEDS_TRANSCODE_EXTS.has(e)) return true;

    // По MIME-type (если браузер не умеет)
    const canPlay = els.video.canPlayType(type);
    if (canPlay === '' || canPlay === 'no') return true;

    return false;
}

// ===== Обработка файла =====
async function handleFile(file) {
    if (!file) return;
    state.currentFile = file;
    state.currentFileName = file.name;
    state.isTranscoded = false;
    if (state.transcodedBlobUrl) {
        URL.revokeObjectURL(state.transcodedBlobUrl);
        state.transcodedBlobUrl = null;
    }

    // Читаем в Uint8Array для FFmpeg
    const arrayBuffer = await file.arrayBuffer();
    state.currentFileData = new Uint8Array(arrayBuffer);

    // Показываем базовую инфу
    const needsTc = needsTranscode(file);
    const canPlay = els.video.canPlayType(file.type);

    showStats({
        'Имя файла': file.name,
        'Размер': formatBytes(file.size),
        'MIME-type': file.type || 'unknown',
        'Расширение': ext(file.name),
        'HTML5 поддержка': canPlay || 'нет',
        'Требуется транскод': needsTc ? 'Да (FFmpeg WASM)' : 'Нет',
    });

    els.placeholder.style.display = 'none';
    els.video.style.display = 'block';

    if (state.ffmpegReady) {
        const inputName = 'input' + ext(file.name);
        await state.ffmpeg.writeFile(inputName, state.currentFileData);
        appendLog(`Файл загружен в FFmpeg FS: ${inputName}`);
    }

    if (!needsTc) {
        // Нативное воспроизведение
        const url = URL.createObjectURL(file);
        els.video.src = url;
        setStatus('ready', '✅ Нативное воспроизведение (HTML5)');
    } else if (state.ffmpegReady) {
        // Автотранскодирование для неподдерживаемых форматов
        setStatus('transcoding', '🔄 Автотранскодирование в MP4...');
        await autoTranscode(file);
    } else {
        setStatus('error', '❌ Формат не поддерживается HTML5, а FFmpeg WASM недоступен');
        els.video.style.display = 'none';
        els.placeholder.style.display = 'block';
        els.placeholder.innerHTML = `<p>❌ Формат не поддерживается</p><p class="hint">${file.name} — требуется FFmpeg WASM для транскодирования</p>`;
    }

    enableButtons(state.ffmpegReady);
}

// ===== Автотранскодирование =====
async function autoTranscode(file) {
    const input = 'input' + ext(file.name);
    const output = 'output_auto.mp4';

    updateProgress(0);
    try {
        await state.ffmpeg.exec([
            '-i', input,
            '-c:v', 'libx264',
            '-preset', 'ultrafast',
            '-crf', '23',
            '-c:a', 'aac',
            '-b:a', '128k',
            '-movflags', '+faststart',
            '-y',
            output
        ]);

        const data = await state.ffmpeg.readFile(output);
        const blob = new Blob([data.buffer], { type: 'video/mp4' });
        state.transcodedBlobUrl = URL.createObjectURL(blob);

        els.video.src = state.transcodedBlobUrl;
        state.isTranscoded = true;

        // Обновляем статистику
        const stats = {
            'Имя файла': file.name,
            'Размер оригинала': formatBytes(file.size),
            'Размер после транскода': formatBytes(blob.size),
            'Режим': 'FFmpeg WASM транскод → H.264/AAC',
        };
        showStats(stats);

        setStatus('ready', '✅ Транскодировано и воспроизводится');
    } catch (e) {
        appendLog('Ошибка транскода: ' + e.message);
        setStatus('error', '❌ Ошибка транскодирования');
    } finally {
        resetProgress();
    }
}

// ===== Ручное транскодирование (если авто не сработало) =====
async function transcodeToMp4() {
    if (!state.ffmpegReady || !state.currentFile) return;
    const input = 'input' + ext(state.currentFileName);
    const output = 'output_manual.mp4';

    setStatus('transcoding', '🔄 Транскодирование в MP4...');
    updateProgress(0);
    els.resultPanel.style.display = 'none';

    try {
        await state.ffmpeg.exec([
            '-i', input,
            '-c:v', 'libx264',
            '-preset', 'fast',
            '-crf', '23',
            '-c:a', 'aac',
            '-b:a', '128k',
            '-movflags', '+faststart',
            '-y',
            output
        ]);

        const data = await state.ffmpeg.readFile(output);
        const blob = new Blob([data.buffer], { type: 'video/mp4' });
        const url = URL.createObjectURL(blob);

        els.video.src = url;
        state.transcodedBlobUrl = url;
        state.isTranscoded = true;

        showResult(blob, 'video/mp4', 'transcoded.mp4');
        setStatus('ready', '✅ Конвертация завершена');
    } catch (e) {
        appendLog('Ошибка: ' + e.message);
        setStatus('error', '❌ Ошибка конвертации');
    } finally {
        resetProgress();
    }
}

// ===== Скриншоты (8 кадров) =====
async function extractThumbnails() {
    if (!state.ffmpegReady || !state.currentFile) return;
    const input = 'input' + ext(state.currentFileName);

    setStatus('transcoding', '🖼 Извлечение скриншотов...');
    updateProgress(0);
    els.thumbsPanel.style.display = 'none';
    els.thumbsGrid.innerHTML = '';

    try {
        // Получаем длительность
        let duration = 60;
        try {
            await state.ffmpeg.exec(['-i', input]);
        } catch (e) {}
        // Парсим лог для длительности (примерно)
        const logText = els.logOutput.textContent;
        const durMatch = logText.match(/Duration: (\d+):(\d+):(\d+\.\d+)/);
        if (durMatch) {
            duration = parseInt(durMatch[1]) * 3600 + parseInt(durMatch[2]) * 60 + parseFloat(durMatch[3]);
        }

        const count = 8;
        const step = duration / (count + 1);

        for (let i = 1; i <= count; i++) {
            const time = (step * i).toFixed(2);
            const outName = `thumb_${i}.jpg`;
            await state.ffmpeg.exec([
                '-ss', String(time),
                '-i', input,
                '-vframes', '1',
                '-q:v', '2',
                '-y',
                outName
            ]);

            const data = await state.ffmpeg.readFile(outName);
            const blob = new Blob([data.buffer], { type: 'image/jpeg' });
            const url = URL.createObjectURL(blob);

            const div = document.createElement('div');
            div.className = 'thumb-item';
            div.innerHTML = `<img src="${url}" alt="thumb"><div class="thumb-label">${formatTime(time)}</div>`;
            els.thumbsGrid.appendChild(div);

            updateProgress(Math.round((i / count) * 100));
        }

        els.thumbsPanel.style.display = 'block';
        setStatus('ready', '✅ Скриншоты готовы');
    } catch (e) {
        appendLog('Ошибка: ' + e.message);
        setStatus('error', '❌ Ошибка извлечения скриншотов');
    } finally {
        resetProgress();
    }
}

function formatTime(sec) {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
}

// ===== GIF =====
async function makeGif() {
    if (!state.ffmpegReady || !state.currentFile) return;
    const input = 'input' + ext(state.currentFileName);
    const output = 'output.gif';

    setStatus('transcoding', '🎞 Создание GIF...');
    updateProgress(0);
    els.resultPanel.style.display = 'none';

    try {
        await state.ffmpeg.exec([
            '-i', input,
            '-t', '3',
            '-vf', 'fps=10,scale=320:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=64[p];[s1][p]paletteuse=dither=bayer',
            '-loop', '0',
            '-y',
            output
        ]);

        const data = await state.ffmpeg.readFile(output);
        showResult(data, 'image/gif', 'preview.gif');
        setStatus('ready', '✅ GIF создан');
    } catch (e) {
        appendLog('Ошибка: ' + e.message);
        setStatus('error', '❌ Ошибка создания GIF');
    } finally {
        resetProgress();
    }
}

// ===== FFmpeg Info =====
async function getFfmpegInfo() {
    if (!state.ffmpegReady || !state.currentFile) return;
    const input = 'input' + ext(state.currentFileName);

    setStatus('loading', '📋 Анализ файла...');
    els.logOutput.textContent = '';

    try {
        await state.ffmpeg.exec(['-i', input]);
    } catch (e) {
        // ffmpeg -i возвращает код 1, но выводит инфо
    }

    // Парсим ключевые поля из лога для Nerd Stats
    const log = els.logOutput.textContent;
    const stats = {};

    const durMatch = log.match(/Duration: ([^,]+)/);
    if (durMatch) stats['Длительность'] = durMatch[1].trim();

    const bitrateMatch = log.match(/bitrate: ([^\s]+)/);
    if (bitrateMatch) stats['Битрейт'] = bitrateMatch[1];

    const codecMatch = log.match(/Video: ([^\(]+)/);
    if (codecMatch) stats['Видео кодек'] = codecMatch[1].trim();

    const audioMatch = log.match(/Audio: ([^\(]+)/);
    if (audioMatch) stats['Аудио кодек'] = audioMatch[1].trim();

    const resMatch = log.match(/(\d{2,5}x\d{2,5})/);
    if (resMatch) stats['Разрешение'] = resMatch[1];

    const fpsMatch = log.match(/(\d+(?:\.\d+)?) fps/);
    if (fpsMatch) stats['FPS'] = fpsMatch[1];

    if (Object.keys(stats).length > 0) {
        showStats({
            'Имя файла': state.currentFileName,
            ...stats,
            'Режим': state.isTranscoded ? 'Транскодировано' : 'Оригинал',
        });
    }

    setStatus('ready', '✅ Информация получена');
}

// ===== Показ статистики =====
function showStats(stats) {
    els.statsGrid.innerHTML = '';
    for (const [key, val] of Object.entries(stats)) {
        const div = document.createElement('div');
        div.className = 'stat-item';
        div.innerHTML = `<div class="stat-label">${key}</div><div class="stat-value">${val}</div>`;
        els.statsGrid.appendChild(div);
    }
    els.statsPanel.style.display = 'block';
}

// ===== Показ результата =====
function showResult(data, mime, filename) {
    const blob = new Blob([data.buffer], { type: mime });
    const url = URL.createObjectURL(blob);

    els.resultContent.innerHTML = '';

    if (mime.startsWith('image/')) {
        const img = document.createElement('img');
        img.src = url;
        els.resultContent.appendChild(img);
    } else if (mime.startsWith('video/')) {
        const vid = document.createElement('video');
        vid.src = url;
        vid.controls = true;
        vid.style.maxWidth = '100%';
        els.resultContent.appendChild(vid);
    }

    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.className = 'download-link';
    link.textContent = '⬇ Скачать ' + filename;
    els.resultContent.appendChild(link);

    els.resultPanel.style.display = 'block';
}

// ===== Старт =====
init();
