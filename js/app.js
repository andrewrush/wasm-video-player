const $ = (sel) => document.querySelector(sel);

const state = {
  ffmpeg: null,
  ffmpegReady: false,
  currentFile: null,
  currentFileName: "",
  currentFileData: null,
  isTranscoded: false,
  transcodedBlobUrl: null,
  webglFilter: null,
  useWebgl: false,
  mseStreamer: null,
};

const els = {
  status: $("#status-bar"),
  diagPanel: $("#diag-panel"),
  diagContent: $("#diag-content"),
  dropZone: $("#drop-zone"),
  fileInput: $("#file-input"),
  video: $("#video-player"),
  canvas: $("#webgl-canvas"),
  playerWrapper: $("#player-wrapper"),
  placeholder: $("#placeholder"),
  statsPanel: $("#stats-panel"),
  statsGrid: $("#stats-grid"),
  ffmpegPanel: $("#ffmpeg-panel"),
  webglPanel: $("#webgl-panel"),
  btnTranscode: $("#btn-transcode"),
  btnThumbs: $("#btn-thumbs"),
  btnGif: $("#btn-gif"),
  btnInfo: $("#btn-info"),
  progress: $("#progress"),
  progressFill: $("#progress-fill"),
  progressText: $("#progress-text"),
  logOutput: $("#log-output"),
  resultPanel: $("#result-panel"),
  resultContent: $("#result-content"),
  thumbsPanel: $("#thumbs-panel"),
  thumbsGrid: $("#thumbs-grid"),
  decoderOverlay: $("#decoder-overlay"),
};

const NEEDS_TRANSCODE_EXTS = new Set([
  ".mkv", ".avi", ".mov", ".flv", ".wmv", ".m2ts", ".ts",
  ".mpeg", ".mpg", ".3gp", ".ogv", ".webm",
]);

/* ===== Status & Logging ===== */
function setStatus(cls, text) {
  els.status.className = "status " + cls;
  els.status.textContent = text;
  console.log("[Status]", text);
}

function diag(msg) {
  const p = document.createElement("p");
  p.textContent = msg;
  els.diagContent.appendChild(p);
  console.log("[Diag]", msg);
}

function appendLog(msg) {
  els.logOutput.textContent += msg + "\n";
  els.logOutput.scrollTop = els.logOutput.scrollHeight;
}

function updateProgress(pct) {
  els.progress.style.display = "flex";
  els.progressFill.style.width = pct + "%";
  els.progressText.textContent = pct + "%";
}

function resetProgress() {
  els.progress.style.display = "none";
  els.progressFill.style.width = "0%";
  els.progressText.textContent = "0%";
}

function enableButtons(enabled) {
  [els.btnTranscode, els.btnThumbs, els.btnGif, els.btnInfo].forEach((btn) => {
    btn.disabled = !enabled || !state.currentFile;
  });
}

/* ===== File Checks ===== */
async function checkFile(url, name) {
  try {
    diag("Проверка " + name + "...");
    const r = await fetch(url, { method: "HEAD" });
    if (!r.ok) {
      diag("❌ " + name + ": HTTP " + r.status);
      return false;
    }
    const ct = r.headers.get("content-type") || "unknown";
    const len = r.headers.get("content-length") || "?";
    diag("✅ " + name + " — " + ct + " (" + len + " bytes)");
    return true;
  } catch (e) {
    diag("❌ " + name + ": " + e.message);
    return false;
  }
}

/* ===== MSE Streamer (v15-fixed) ===== */
class MseStreamer {
  constructor(video) {
    this.video = video;
    this.ms = null;
    this.sb = null;
    this.queue = [];
    this.isOpen = false;
    this.sourceUrl = null;
    this._onVideoError = null;
    this._sbErrorHandler = null;
    this._sbUpdateEndHandler = null;
    this._sbAbortHandler = null;
    this._msSourceOpenHandler = null;
    this._msErrorHandler = null;
    this._msSourceEndedHandler = null;
  }

  async init(mimeCodec) {
    if (!window.MediaSource) {
      throw new Error("MediaSource not supported");
    }
    if (!MediaSource.isTypeSupported(mimeCodec)) {
      throw new Error("MIME type not supported: " + mimeCodec);
    }

    return new Promise((resolve, reject) => {
      this.ms = new MediaSource();
      this._msErrorHandler = (e) => {
        console.error("[MSE] MediaSource error:", e);
        reject(new Error("MediaSource error"));
      };
      this._msSourceEndedHandler = () => {
        console.log("[MSE] sourceended");
      };
      this.ms.addEventListener("error", this._msErrorHandler);
      this.ms.addEventListener("sourceended", this._msSourceEndedHandler);

      this._msSourceOpenHandler = () => {
        console.log("[MSE] sourceopen");
        this.isOpen = true;
        try {
          this.sb = this.ms.addSourceBuffer(mimeCodec);
          this.sb.mode = "segments";

          this._sbErrorHandler = (e) => {
            console.error("[MSE] SourceBuffer error:", e);
            diag("❌ SourceBuffer error — возможно, битый init-сегмент или несовместимый кодек");
            this._drainQueue();
          };
          this._sbAbortHandler = () => {
            console.warn("[MSE] SourceBuffer abort");
          };
          this._sbUpdateEndHandler = () => {
            this._processQueue();
          };

          this.sb.addEventListener("error", this._sbErrorHandler);
          this.sb.addEventListener("abort", this._sbAbortHandler);
          this.sb.addEventListener("updateend", this._sbUpdateEndHandler);

          // Отключаем video.onerror на время streaming
          this._onVideoError = this.video.onerror;
          this.video.onerror = null;

          resolve();
        } catch (err) {
          reject(err);
        }
      };
      this.ms.addEventListener("sourceopen", this._msSourceOpenHandler);

      this.sourceUrl = URL.createObjectURL(this.ms);
      this.video.src = this.sourceUrl;
    });
  }

  appendBuffer(data) {
    if (!this.sb) return;
    this.queue.push(data);
    this._processQueue();
  }

  _processQueue() {
    if (!this.sb || this.sb.updating || this.queue.length === 0) return;
    try {
      const data = this.queue.shift();
      this.sb.appendBuffer(data);
    } catch (e) {
      console.error("[MSE] appendBuffer error:", e);
      diag("❌ appendBuffer failed: " + e.message);
      if (e.name === "QuotaExceededError") {
        try {
          this.sb.remove(0, this.video.currentTime - 5);
        } catch (_) {}
      }
    }
  }

  _drainQueue() {
    this.queue = [];
  }

  setTimestampOffset(offset) {
    if (!this.sb || this.sb.updating) return false;
    try {
      this.sb.timestampOffset = offset;
      return true;
    } catch (e) {
      console.warn("[MSE] timestampOffset error:", e);
      return false;
    }
  }

  endOfStream() {
    if (this.ms && this.ms.readyState === "open") {
      try {
        this.ms.endOfStream();
      } catch (e) {
        console.warn("[MSE] endOfStream error:", e);
      }
    }
  }

  destroy() {
    this._drainQueue();
    if (this.sb) {
      try {
        this.sb.removeEventListener("error", this._sbErrorHandler);
        this.sb.removeEventListener("abort", this._sbAbortHandler);
        this.sb.removeEventListener("updateend", this._sbUpdateEndHandler);
        if (this.ms && this.ms.readyState === "open") {
          this.ms.removeSourceBuffer(this.sb);
        }
      } catch (_) {}
      this.sb = null;
    }
    if (this.ms) {
      try {
        this.ms.removeEventListener("error", this._msErrorHandler);
        this.ms.removeEventListener("sourceopen", this._msSourceOpenHandler);
        this.ms.removeEventListener("sourceended", this._msSourceEndedHandler);
        if (this.ms.readyState === "open") {
          this.ms.endOfStream();
        }
      } catch (_) {}
      this.ms = null;
    }
    if (this.sourceUrl) {
      URL.revokeObjectURL(this.sourceUrl);
      this.sourceUrl = null;
    }
    if (this._onVideoError) {
      this.video.onerror = this._onVideoError;
      this._onVideoError = null;
    }
  }
}

/* ===== UI Events ===== */
function setupEvents() {
  els.dropZone.addEventListener("click", () => els.fileInput.click());
  els.fileInput.addEventListener("change", (e) => handleFile(e.target.files[0]));

  els.dropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    els.dropZone.classList.add("dragover");
  });
  els.dropZone.addEventListener("dragleave", () => {
    els.dropZone.classList.remove("dragover");
  });
  els.dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    els.dropZone.classList.remove("dragover");
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith("video/")) handleFile(file);
  });

  els.btnTranscode.addEventListener("click", transcodeToMp4);
  els.btnThumbs.addEventListener("click", extractThumbnails);
  els.btnGif.addEventListener("click", makeGif);
  els.btnInfo.addEventListener("click", getFfmpegInfo);

  const webglToggle = $("#webgl-toggle");
  if (webglToggle) {
    webglToggle.addEventListener("change", (e) => {
      state.useWebgl = e.target.checked;
      updatePlayerMode();
    });
  }

  document.querySelectorAll(".filter-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!state.webglFilter) return;
      document.querySelectorAll(".filter-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      state.webglFilter.setFilter(btn.dataset.filter);
    });
  });

  const btnDecoder = $("#btn-decoder-ffmpeg");
  if (btnDecoder) {
    btnDecoder.addEventListener("click", () => {
      els.decoderOverlay.style.display = "none";
      if (state.currentFile && state.ffmpegReady) {
        autoTranscode(state.currentFile, true);
      }
    });
  }

  els.video.addEventListener("error", (e) => {
    console.error("[Video] error:", els.video.error);
    if (state.mseStreamer) return;
    const err = els.video.error;
    let msg = "Ошибка воспроизведения";
    if (err) {
      switch (err.code) {
        case MediaError.MEDIA_ERR_ABORTED: msg = "Воспроизведение прервано"; break;
        case MediaError.MEDIA_ERR_NETWORK: msg = "Ошибка сети"; break;
        case MediaError.MEDIA_ERR_DECODE: msg = "Ошибка декодирования"; break;
        case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED: msg = "Формат не поддерживается"; break;
      }
    }
    diag("❌ HTML5 Video: " + msg);
    setStatus("error", "❌ " + msg);
    showDecoderOverlay(msg);
  });
}

function showDecoderOverlay(msg) {
  if (!els.decoderOverlay) return;
  const title = els.decoderOverlay.querySelector("h3");
  const desc = els.decoderOverlay.querySelector("p");
  if (title) title.textContent = "❌ " + (msg || "Ошибка декодирования");
  if (desc) desc.textContent = "Попробуйте транскодировать через FFmpeg WASM";
  els.decoderOverlay.style.display = "flex";
}

function hideDecoderOverlay() {
  if (els.decoderOverlay) els.decoderOverlay.style.display = "none";
}

function updatePlayerMode() {
  if (!els.playerWrapper) return;
  if (state.useWebgl && state.webglFilter) {
    els.playerWrapper.setAttribute("data-mode", "webgl");
    state.webglFilter.start();
  } else {
    els.playerWrapper.setAttribute("data-mode", "video");
    if (state.webglFilter) state.webglFilter.stop();
  }
}

/* ===== FFmpeg Init ===== */
async function initFfmpeg() {
  setStatus("loading", "Диагностика файлов...");
  els.diagPanel.style.display = "block";
  els.diagContent.innerHTML = "";

  const base = location.href.replace(/\/$/, "");
  const coreURL = base + "/js/ffmpeg/ffmpeg-core.js";
  const wasmURL = base + "/js/ffmpeg/ffmpeg-core.wasm";

  diag("Base URL: " + base);

  const ok1 = await checkFile(coreURL.replace("ffmpeg-core.js", "ffmpeg.js"), "ffmpeg.js");
  const ok2 = await checkFile(coreURL, "ffmpeg-core.js");
  const ok3 = await checkFile(wasmURL, "ffmpeg-core.wasm");

  if (!ok1 || !ok2 || !ok3) {
    setStatus("error", "❌ Не все файлы доступны. Подождите 2 мин (кеш GitHub Pages) и обновите.");
    return;
  }

  const wasmSupported = typeof WebAssembly === "object" && typeof WebAssembly.instantiate === "function";
  if (!wasmSupported) {
    diag("❌ WebAssembly не поддерживается браузером");
    setStatus("fallback", "⚡ HTML5 режим (WASM не поддерживается)");
    return;
  }
  diag("✅ WebAssembly поддерживается");

  if (typeof FFmpegWASM === "undefined") {
    diag("❌ FFmpegWASM не определён — ffmpeg.js не загрузился");
    setStatus("error", "❌ ffmpeg.js не загрузился");
    return;
  }
  diag("✅ FFmpegWASM определён");

  setStatus("loading", "Загрузка FFmpeg WASM (~30MB, 1–3 мин)...");

  try {
    const { FFmpeg } = FFmpegWASM;
    state.ffmpeg = new FFmpeg();

    state.ffmpeg.on("log", ({ message }) => {
      appendLog(message);
      console.log("[FFmpeg]", message);
    });
    state.ffmpeg.on("progress", ({ progress }) => {
      updateProgress(Math.round(progress * 100));
    });

    diag("Вызов ffmpeg.load({ coreURL, wasmURL })...");
    const startTime = Date.now();

    await state.ffmpeg.load({ coreURL: coreURL, wasmURL: wasmURL });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    state.ffmpegReady = true;

    setStatus("ready", "✅ FFmpeg WASM готов (" + elapsed + "с)");
    els.ffmpegPanel.style.display = "block";
    enableButtons(true);
    diag("✅ Инициализация завершена за " + elapsed + "с");
  } catch (err) {
    console.error(err);
    diag("❌ Ошибка инициализации: " + err.message);
    setStatus("error", "❌ " + (err.message || "FFmpeg WASM недоступен"));
    appendLog("ERROR: " + err.message);
    if (err.stack) appendLog("STACK: " + err.stack);
  }
}

/* ===== Helpers ===== */
function formatBytes(b) {
  if (b === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(b) / Math.log(k));
  return parseFloat((b / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

function ext(name) {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i).toLowerCase() : ".mp4";
}

function needsTranscode(file) {
  const e = ext(file.name);
  const type = file.type.toLowerCase();
  if (NEEDS_TRANSCODE_EXTS.has(e)) return true;
  const canPlay = els.video.canPlayType(type);
  if (canPlay === "" || canPlay === "no") return true;
  return false;
}

/* ===== File Handling ===== */
async function handleFile(file) {
  if (!file) return;
  state.currentFile = file;
  state.currentFileName = file.name;
  state.isTranscoded = false;
  if (state.transcodedBlobUrl) {
    URL.revokeObjectURL(state.transcodedBlobUrl);
    state.transcodedBlobUrl = null;
  }
  hideDecoderOverlay();

  const arrayBuffer = await file.arrayBuffer();
  state.currentFileData = new Uint8Array(arrayBuffer);

  const needsTc = needsTranscode(file);
  const canPlay = els.video.canPlayType(file.type);

  showStats({
    "Имя файла": file.name,
    Размер: formatBytes(file.size),
    "MIME-type": file.type || "unknown",
    Расширение: ext(file.name),
    "HTML5 поддержка": canPlay || "нет",
    "Требуется транскод": needsTc ? "Да (FFmpeg WASM)" : "Нет",
  });

  els.placeholder.style.display = "none";
  els.video.style.display = "block";
  updatePlayerMode();

  if (state.ffmpegReady) {
    const inputName = "input" + ext(file.name);
    await state.ffmpeg.writeFile(inputName, state.currentFileData);
    appendLog("Файл загружен в FFmpeg FS: " + inputName);
  }

  if (!needsTc) {
    const url = URL.createObjectURL(file);
    els.video.src = url;
    setStatus("ready", "✅ Нативное воспроизведение (HTML5)");
    setupWebgl();
  } else if (state.ffmpegReady) {
    setStatus("transcoding", "🔄 Автотранскодирование в MP4...");
    await autoTranscode(file);
  } else {
    setStatus("error", "❌ Формат не поддерживается HTML5, а FFmpeg WASM недоступен");
    els.video.style.display = "none";
    els.placeholder.style.display = "block";
    els.placeholder.innerHTML = `
      <div style="color:var(--danger)">❌ Формат не поддерживается</div>
      <div class="hint">${file.name} — требуется FFmpeg WASM</div>
    `;
  }

  enableButtons(state.ffmpegReady);
}

function setupWebgl() {
  if (!els.canvas || !window.WebGLVideoFilter) return;
  try {
    if (!state.webglFilter) {
      state.webglFilter = new WebGLVideoFilter(els.canvas);
    }
    state.webglFilter.setVideo(els.video);
    if (state.useWebgl) {
      updatePlayerMode();
    }
  } catch (e) {
    console.warn("WebGL init failed:", e);
  }
}

/* ===== Transcoding ===== */
async function autoTranscode(file, force = false) {
  const STREAMING_THRESHOLD = 64 * 1024 * 1024;
  if (!force && file.size > STREAMING_THRESHOLD) {
    diag("📦 Файл > 64MB, пробуем streaming pipeline...");
    const ok = await tryStreaming(file);
    if (ok) return;
    diag("⚠️ Streaming не удался, переключаемся на legacy transcode...");
  }
  await legacyFullTranscode(file);
}

async function tryStreaming(file) {
  const input = "input" + ext(file.name);
  const SEG_DURATION = 10;

  try {
    let duration = 60;
    try {
      await state.ffmpeg.exec(["-i", input]);
    } catch (_) {}
    const logText = els.logOutput.textContent;
    const durMatch = logText.match(/Duration: (\d+):(\d+):(\d+\.\d+)/);
    if (durMatch) {
      duration = parseInt(durMatch[1]) * 3600 + parseInt(durMatch[2]) * 60 + parseFloat(durMatch[3]);
    }
    diag("⏱ Длительность: " + duration.toFixed(1) + "с");

    if (state.mseStreamer) {
      state.mseStreamer.destroy();
      state.mseStreamer = null;
    }

    const mimeCodec = 'video/mp4; codecs="avc1.42E01E, mp4a.40.2"';
    state.mseStreamer = new MseStreamer(els.video);
    await state.mseStreamer.init(mimeCodec);
    diag("✅ MediaSource открыт");

    await state.ffmpeg.exec([
      "-i", input,
      "-c:v", "libx264",
      "-preset", "ultrafast",
      "-crf", "23",
      "-c:a", "aac",
      "-b:a", "128k",
      "-movflags", "frag_keyframe+empty_moov+default_base_moof",
      "-t", "0",
      "-f", "mp4",
      "init.mp4",
    ]);

    const initData = await state.ffmpeg.readFile("init.mp4");
    const initBuf = initData.buffer ? initData.buffer.slice(initData.byteOffset, initData.byteOffset + initData.byteLength) : initData;

    if (initBuf.byteLength < 100) {
      throw new Error("Init segment слишком маленький (" + initBuf.byteLength + " bytes)");
    }
    diag("📦 Init segment: " + initBuf.byteLength + " bytes");

    state.mseStreamer.appendBuffer(initBuf);

    await new Promise((resolve) => {
      const check = () => {
        if (state.mseStreamer.queue.length === 0 && !state.mseStreamer.sb.updating) {
          resolve();
        } else {
          setTimeout(check, 50);
        }
      };
      setTimeout(check, 100);
    });

    const numSegs = Math.ceil(duration / SEG_DURATION);
    for (let i = 0; i < numSegs; i++) {
      const start = i * SEG_DURATION;
      const segName = "seg_" + i + ".m4s";

      updateProgress(Math.round((i / numSegs) * 100));
      setStatus("transcoding", "🔄 Стриминг чанк " + (i + 1) + "/" + numSegs + "...");

      await state.ffmpeg.exec([
        "-i", input,
        "-c:v", "libx264",
        "-preset", "ultrafast",
        "-crf", "23",
        "-c:a", "aac",
        "-b:a", "128k",
        "-movflags", "frag_keyframe+empty_moov+default_base_moof",
        "-ss", String(start),
        "-t", String(SEG_DURATION),
        "-f", "mp4",
        segName,
      ]);

      const segData = await state.ffmpeg.readFile(segName);
      const segBuf = segData.buffer ? segData.buffer.slice(segData.byteOffset, segData.byteOffset + segData.byteLength) : segData;

      if (segBuf.byteLength > 0) {
        const initEnd = findMoofOffset(new Uint8Array(segBuf));
        if (initEnd > 0 && i === 0) {
          const mediaBuf = segBuf.slice(initEnd);
          if (mediaBuf.byteLength > 0) {
            state.mseStreamer.setTimestampOffset(start);
            state.mseStreamer.appendBuffer(mediaBuf);
          }
        } else {
          state.mseStreamer.setTimestampOffset(start);
          state.mseStreamer.appendBuffer(segBuf);
        }
      }

      try { await state.ffmpeg.deleteFile(segName); } catch (_) {}
    }

    await new Promise((resolve) => {
      const check = () => {
        if (state.mseStreamer.queue.length === 0 && !state.mseStreamer.sb.updating) {
          resolve();
        } else {
          setTimeout(check, 100);
        }
      };
      setTimeout(check, 200);
    });

    state.mseStreamer.endOfStream();
    setStatus("ready", "✅ Стриминг завершён");
    setupWebgl();
    resetProgress();
    return true;
  } catch (e) {
    console.error("[Streaming] failed:", e);
    diag("❌ Streaming pipeline ошибка: " + e.message);
    if (state.mseStreamer) {
      state.mseStreamer.destroy();
      state.mseStreamer = null;
    }
    return false;
  }
}

function findMoofOffset(buf) {
  let offset = 0;
  while (offset < buf.length - 8) {
    const size = (buf[offset] << 24) | (buf[offset + 1] << 16) | (buf[offset + 2] << 8) | buf[offset + 3];
    const type = String.fromCharCode(buf[offset + 4], buf[offset + 5], buf[offset + 6], buf[offset + 7]);
    if (type === "moof") return offset;
    if (size === 0 || size > buf.length - offset) break;
    offset += size;
  }
  return 0;
}

async function legacyFullTranscode(file) {
  const input = "input" + ext(file.name);
  const output = "output_legacy.mp4";
  updateProgress(0);

  try {
    setStatus("transcoding", "🔄 Полное транскодирование...");
    await state.ffmpeg.exec([
      "-i", input,
      "-c:v", "libx264",
      "-preset", "ultrafast",
      "-crf", "23",
      "-c:a", "aac",
      "-b:a", "128k",
      "-movflags", "+faststart",
      "-y",
      output,
    ]);

    const data = await state.ffmpeg.readFile(output);
    const blob = new Blob([data.buffer], { type: "video/mp4" });
    state.transcodedBlobUrl = URL.createObjectURL(blob);
    els.video.src = state.transcodedBlobUrl;
    state.isTranscoded = true;

    showStats({
      "Имя файла": file.name,
      "Размер оригинала": formatBytes(file.size),
      "Размер после транскода": formatBytes(blob.size),
      Режим: "FFmpeg WASM legacy транскод → H.264/AAC",
    });

    setStatus("ready", "✅ Транскодировано и воспроизводится");
    setupWebgl();
  } catch (e) {
    appendLog("Ошибка транскода: " + e.message);
    setStatus("error", "❌ Ошибка транскодирования");
  } finally {
    resetProgress();
  }
}

async function transcodeToMp4() {
  if (!state.ffmpegReady || !state.currentFile) return;
  hideDecoderOverlay();
  await legacyFullTranscode(state.currentFile);
}

async function extractThumbnails() {
  if (!state.ffmpegReady || !state.currentFile) return;
  const input = "input" + ext(state.currentFileName);

  setStatus("transcoding", "🖼 Извлечение скриншотов...");
  updateProgress(0);
  els.thumbsPanel.style.display = "none";
  els.thumbsGrid.innerHTML = "";

  try {
    let duration = 60;
    try {
      await state.ffmpeg.exec(["-i", input]);
    } catch (e) {}
    const logText = els.logOutput.textContent;
    const durMatch = logText.match(/Duration: (\d+):(\d+):(\d+\.\d+)/);
    if (durMatch) {
      duration = parseInt(durMatch[1]) * 3600 + parseInt(durMatch[2]) * 60 + parseFloat(durMatch[3]);
    }

    const count = 8;
    const step = duration / (count + 1);

    for (let i = 1; i <= count; i++) {
      const time = (step * i).toFixed(2);
      const outName = "thumb_" + i + ".jpg";
      await state.ffmpeg.exec([
        "-ss", String(time),
        "-i", input,
        "-vframes", "1",
        "-q:v", "2",
        "-y",
        outName,
      ]);

      const data = await state.ffmpeg.readFile(outName);
      const blob = new Blob([data.buffer], { type: "image/jpeg" });
      const url = URL.createObjectURL(blob);

      const div = document.createElement("div");
      div.className = "thumb-item";
      div.innerHTML = `<img src="${url}" alt="thumb"><div class="thumb-label">${formatTime(time)}</div>`;
      els.thumbsGrid.appendChild(div);

      updateProgress(Math.round((i / count) * 100));
    }

    els.thumbsPanel.style.display = "block";
    setStatus("ready", "✅ Скриншоты готовы");
  } catch (e) {
    appendLog("Ошибка: " + e.message);
    setStatus("error", "❌ Ошибка извлечения скриншотов");
  } finally {
    resetProgress();
  }
}

function formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return m + ":" + s.toString().padStart(2, "0");
}

async function makeGif() {
  if (!state.ffmpegReady || !state.currentFile) return;
  const input = "input" + ext(state.currentFileName);
  const output = "output.gif";

  setStatus("transcoding", "🎞 Создание GIF...");
  updateProgress(0);
  els.resultPanel.style.display = "none";

  try {
    await state.ffmpeg.exec([
      "-i", input,
      "-t", "3",
      "-vf", "fps=10,scale=320:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=64[p];[s1][p]paletteuse=dither=bayer",
      "-loop", "0",
      "-y",
      output,
    ]);

    const data = await state.ffmpeg.readFile(output);
    showResult(data, "image/gif", "preview.gif");
    setStatus("ready", "✅ GIF создан");
  } catch (e) {
    appendLog("Ошибка: " + e.message);
    setStatus("error", "❌ Ошибка создания GIF");
  } finally {
    resetProgress();
  }
}

async function getFfmpegInfo() {
  if (!state.ffmpegReady || !state.currentFile) return;
  const input = "input" + ext(state.currentFileName);

  setStatus("loading", "📋 Анализ файла...");
  els.logOutput.textContent = "";

  try {
    await state.ffmpeg.exec(["-i", input]);
  } catch (e) {}

  const log = els.logOutput.textContent;
  const stats = {};
  const durMatch = log.match(/Duration: ([^,]+)/);
  if (durMatch) stats["Длительность"] = durMatch[1].trim();
  const bitrateMatch = log.match(/bitrate: ([^\s]+)/);
  if (bitrateMatch) stats["Битрейт"] = bitrateMatch[1];
  const codecMatch = log.match(/Video: ([^\(]+)/);
  if (codecMatch) stats["Видео кодек"] = codecMatch[1].trim();
  const audioMatch = log.match(/Audio: ([^\(]+)/);
  if (audioMatch) stats["Аудио кодек"] = audioMatch[1].trim();
  const resMatch = log.match(/(\d{2,5}x\d{2,5})/);
  if (resMatch) stats["Разрешение"] = resMatch[1];
  const fpsMatch = log.match(/(\d+(?:\.\d+)?) fps/);
  if (fpsMatch) stats["FPS"] = fpsMatch[1];

  if (Object.keys(stats).length > 0) {
    showStats({
      "Имя файла": state.currentFileName,
      ...stats,
      Режим: state.isTranscoded ? "Транскодировано" : "Оригинал",
    });
  }

  setStatus("ready", "✅ Информация получена");
}

function showStats(stats) {
  els.statsGrid.innerHTML = "";
  for (const [key, val] of Object.entries(stats)) {
    const div = document.createElement("div");
    div.className = "stat-item";
    div.innerHTML = `<div class="stat-label">${key}</div><div class="stat-value">${val}</div>`;
    els.statsGrid.appendChild(div);
  }
  els.statsPanel.style.display = "block";
}

function showResult(data, mime, filename) {
  const blob = new Blob([data.buffer], { type: mime });
  const url = URL.createObjectURL(blob);

  els.resultContent.innerHTML = "";

  if (mime.startsWith("image/")) {
    const img = document.createElement("img");
    img.src = url;
    els.resultContent.appendChild(img);
  } else if (mime.startsWith("video/")) {
    const vid = document.createElement("video");
    vid.src = url;
    vid.controls = true;
    vid.style.maxWidth = "100%";
    els.resultContent.appendChild(vid);
  }

  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.className = "download-link";
  link.textContent = "⬇ Скачать " + filename;
  els.resultContent.appendChild(link);

  els.resultPanel.style.display = "block";
}

/* ===== Start ===== */
setupEvents();
initFfmpeg();
