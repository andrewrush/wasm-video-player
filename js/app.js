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
        tryFfmpegFallback(state.currentFile);
      }
    });
  }

  els.video.addEventListener("error", (e) => {
    console.error("[Video] error:", els.video.error);
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
    await tryFfmpegFallback(file);
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

/* ===== FFmpeg Fallback with full logging ===== */
async function tryFfmpegFallback(file) {
  console.log("=== tryFfmpegFallback START ===");
  appendLog("=== tryFfmpegFallback START ===");

  if (!state.ffmpegReady) {
    diag("❌ FFmpeg не готов");
    console.log("❌ FFmpeg не готов");
    return;
  }
  diag("✅ FFmpeg готов");
  console.log("✅ FFmpeg готов");

  const inputName = "input" + ext(file.name);
  diag("Загрузка файла в FFmpeg...");
  console.log("Загрузка файла в FFmpeg...");
  await state.ffmpeg.writeFile(inputName, state.currentFileData);
  diag("✅ Файл в FFmpeg");
  console.log("✅ Файл в FFmpeg");

  const STREAMING_THRESHOLD = 64 * 1024 * 1024;
  if (file.size > STREAMING_THRESHOLD) {
    diag("Режим=streaming, размер=" + formatBytes(file.size) + ", порог=64MB → стриминг");
    console.log("Режим=streaming, размер=" + formatBytes(file.size) + ", порог=64MB → стриминг");
    const ok = await streamingPipeline(inputName);
    if (ok) return;
    diag("⚠️ Стриминг не удался, fallback на legacy...");
    console.log("⚠️ Стриминг не удался, fallback на legacy...");
  } else {
    diag("Режим=legacy, размер=" + formatBytes(file.size) + " < 64MB → полный транскод");
    console.log("Режим=legacy, размер=" + formatBytes(file.size) + " < 64MB → полный транскод");
  }

  await legacyFullTranscode(file);
  console.log("=== tryFfmpegFallback END ===");
  appendLog("=== tryFfmpegFallback END ===");
}

/* ===== Streaming Pipeline with FULL logging ===== */
async function streamingPipeline(inputName) {
  console.log("=== streamingPipeline START ===");
  appendLog("=== streamingPipeline START ===");

  const SEG_DURATION = 10;
  const mimeCodec = 'video/mp4; codecs="avc1.42E01E, mp4a.40.2"';
  let ms = null;
  let sb = null;
  let sourceUrl = null;

  try {
    // Step 1: MediaSource
    console.log("[SP] new MediaSource()");
    appendLog("[SP] new MediaSource()");
    ms = new MediaSource();

    console.log("[SP] createObjectURL");
    appendLog("[SP] createObjectURL");
    sourceUrl = URL.createObjectURL(ms);

    console.log("[SP] video.src = msUrl");
    appendLog("[SP] video.src = msUrl");
    els.video.src = sourceUrl;

    // Step 2: wait sourceopen
    console.log("[SP] await sourceopen");
    appendLog("[SP] await sourceopen");
    await new Promise((resolve, reject) => {
      const onOpen = () => {
        console.log("[SP] sourceopen OK");
        appendLog("[SP] sourceopen OK");
        ms.removeEventListener("sourceopen", onOpen);
        resolve();
      };
      const onErr = (e) => {
        console.error("[SP] MediaSource error:", e);
        appendLog("[SP] ❌ MediaSource error");
        ms.removeEventListener("error", onErr);
        reject(new Error("MediaSource error"));
      };
      ms.addEventListener("sourceopen", onOpen);
      ms.addEventListener("error", onErr);
    });

    // Step 3: sniff codecs
    console.log("[SP] sniffCodecs");
    appendLog("[SP] sniffCodecs");
    if (!MediaSource.isTypeSupported(mimeCodec)) {
      throw new Error("MIME type not supported: " + mimeCodec);
    }
    console.log("[SP] sniffCodecs OK, copy=false");
    appendLog("[SP] sniffCodecs OK, copy=false");

    // Step 4: addSourceBuffer
    console.log("[SP] addSourceBuffer: " + mimeCodec);
    appendLog("[SP] addSourceBuffer: " + mimeCodec);
    sb = ms.addSourceBuffer(mimeCodec);
    sb.mode = "segments";
    console.log("[SP] addSourceBuffer OK");
    appendLog("[SP] addSourceBuffer OK");

    // Step 5: get duration
    console.log("[SP] IN=" + inputName + ", D=" + SEG_DURATION);
    appendLog("[SP] IN=" + inputName + ", D=" + SEG_DURATION);

    let duration = 60;
    try {
      await state.ffmpeg.exec(["-i", inputName]);
    } catch (_) {}
    const logText = els.logOutput.textContent;
    const durMatch = logText.match(/Duration: (\d+):(\d+):(\d+\.\d+)/);
    if (durMatch) {
      duration = parseInt(durMatch[1]) * 3600 + parseInt(durMatch[2]) * 60 + parseFloat(durMatch[3]);
    }
    console.log("[SP] duration=" + duration.toFixed(1) + "s");
    appendLog("[SP] duration=" + duration.toFixed(1) + "s");

    // Step 6: generate init segment
    console.log("[SP] generating init segment...");
    appendLog("[SP] generating init segment...");
    await state.ffmpeg.exec([
      "-i", inputName,
      "-c:v", "libx264",
      "-preset", "ultrafast",
      "-crf", "23",
      "-c:a", "aac",
      "-b:a", "128k",
      "-movflags", "frag_keyframe+empty_moov+default_base_moof",
      "-t", "0",
      "-f", "mp4",
      "/init.mp4",
    ]);

    const initData = await state.ffmpeg.readFile("/init.mp4");
    const initBuf = initData.buffer
      ? initData.buffer.slice(initData.byteOffset, initData.byteOffset + initData.byteLength)
      : initData;
    console.log("[SP] init segment size=" + initBuf.byteLength);
    appendLog("[SP] init segment size=" + initBuf.byteLength);

    if (initBuf.byteLength < 100) {
      throw new Error("Init segment слишком маленький (" + initBuf.byteLength + " bytes)");
    }

    // Step 7: append init
    console.log("[SP] appending init...");
    appendLog("[SP] appending init...");
    await new Promise((resolve, reject) => {
      if (sb.updating) {
        const onUpdate = () => {
          sb.removeEventListener("updateend", onUpdate);
          try {
            sb.appendBuffer(initBuf);
          } catch (e) {
            reject(e);
            return;
          }
          const onDone = () => {
            sb.removeEventListener("updateend", onDone);
            sb.removeEventListener("error", onErr);
            resolve();
          };
          const onErr = (e) => {
            sb.removeEventListener("updateend", onDone);
            sb.removeEventListener("error", onErr);
            reject(new Error("SourceBuffer error on init append"));
          };
          sb.addEventListener("updateend", onDone);
          sb.addEventListener("error", onErr);
        };
        sb.addEventListener("updateend", onUpdate);
      } else {
        try {
          sb.appendBuffer(initBuf);
        } catch (e) {
          reject(e);
          return;
        }
        const onDone = () => {
          sb.removeEventListener("updateend", onDone);
          sb.removeEventListener("error", onErr);
          resolve();
        };
        const onErr = (e) => {
          sb.removeEventListener("updateend", onDone);
          sb.removeEventListener("error", onErr);
          reject(new Error("SourceBuffer error on init append"));
        };
        sb.addEventListener("updateend", onDone);
        sb.addEventListener("error", onErr);
      }
    });
    console.log("[SP] init appended OK");
    appendLog("[SP] init appended OK");

    // Step 8: stream chunks
    const numSegs = Math.ceil(duration / SEG_DURATION);
    for (let i = 0; i < numSegs; i++) {
      const start = i * SEG_DURATION;
      const segName = "/seg_" + i + ".mp4";

      console.log("[SP] === Чанк T=" + start + " ===");
      appendLog("[SP] === Чанк T=" + start + " ===");

      updateProgress(Math.round((i / numSegs) * 100));
      setStatus("transcoding", "🔄 Стриминг чанк " + (i + 1) + "/" + numSegs + "...");

      console.log("[SP] exec ffmpeg chunk...");
      appendLog("[SP] exec ffmpeg chunk...");
      await state.ffmpeg.exec([
        "-i", inputName,
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
      console.log("[SP] exec OK");
      appendLog("[SP] exec OK");

      console.log("[SP] readFile " + segName + "...");
      appendLog("[SP] readFile " + segName + "...");
      const segData = await state.ffmpeg.readFile(segName);
      const segBuf = segData.buffer
        ? segData.buffer.slice(segData.byteOffset, segData.byteOffset + segData.byteLength)
        : segData;
      console.log("[SP] readFile OK, " + formatBytes(segBuf.byteLength));
      appendLog("[SP] readFile OK, " + formatBytes(segBuf.byteLength));

      console.log("[SP] deleteFile " + segName + "...");
      appendLog("[SP] deleteFile " + segName + "...");
      try { await state.ffmpeg.deleteFile(segName); } catch (_) {}
      console.log("[SP] deleteFile OK");
      appendLog("[SP] deleteFile OK");

      // Split init and media
      console.log("[SP] split init/media...");
      appendLog("[SP] split init/media...");
      const { init: segInit, media } = splitInitSegment(new Uint8Array(segBuf));
      console.log("[SP] split: init=" + segInit.byteLength + ", media=" + media.byteLength);
      appendLog("[SP] split: init=" + segInit.byteLength + ", media=" + media.byteLength);

      const bufToAppend = media.byteLength > 0 ? media : segBuf;

      // Set timestampOffset BEFORE append
      console.log("[SP] timestampOffset=" + start);
      appendLog("[SP] timestampOffset=" + start);
      if (!sb.updating) {
        sb.timestampOffset = start;
      } else {
        await new Promise((resolve) => {
          const onUpdate = () => {
            sb.removeEventListener("updateend", onUpdate);
            sb.timestampOffset = start;
            resolve();
          };
          sb.addEventListener("updateend", onUpdate);
        });
      }

      // Append chunk
      console.log("[SP] appending chunk buffer...");
      appendLog("[SP] appending chunk buffer...");
      await new Promise((resolve, reject) => {
        if (sb.updating) {
          const onUpdate = () => {
            sb.removeEventListener("updateend", onUpdate);
            try {
              sb.appendBuffer(bufToAppend);
            } catch (e) {
              reject(e);
              return;
            }
            const onDone = () => {
              sb.removeEventListener("updateend", onDone);
              sb.removeEventListener("error", onErr);
              resolve();
            };
            const onErr = (e) => {
              sb.removeEventListener("updateend", onDone);
              sb.removeEventListener("error", onErr);
              reject(new Error("SourceBuffer error on chunk append"));
            };
            sb.addEventListener("updateend", onDone);
            sb.addEventListener("error", onErr);
          };
          sb.addEventListener("updateend", onUpdate);
        } else {
          try {
            sb.appendBuffer(bufToAppend);
          } catch (e) {
            reject(e);
            return;
          }
          const onDone = () => {
            sb.removeEventListener("updateend", onDone);
            sb.removeEventListener("error", onErr);
            resolve();
          };
          const onErr = (e) => {
            sb.removeEventListener("updateend", onDone);
            sb.removeEventListener("error", onErr);
            reject(new Error("SourceBuffer error on chunk append"));
          };
          sb.addEventListener("updateend", onDone);
          sb.addEventListener("error", onErr);
        }
      });
      console.log("[SP] chunk appended OK");
      appendLog("[SP] chunk appended OK");
    }

    // End of stream
    console.log("[SP] endOfStream()");
    appendLog("[SP] endOfStream()");
    if (ms.readyState === "open") {
      try { ms.endOfStream(); } catch (e) {
        console.warn("[SP] endOfStream error:", e);
        appendLog("[SP] endOfStream warning: " + e.message);
      }
    }

    setStatus("ready", "✅ Стриминг завершён");
    setupWebgl();
    resetProgress();
    console.log("=== streamingPipeline SUCCESS ===");
    appendLog("=== streamingPipeline SUCCESS ===");
    return true;

  } catch (e) {
    console.error("❌ streamingPipeline EXCEPTION:", e);
    appendLog("❌ streamingPipeline EXCEPTION: " + e.message);
    if (ms && ms.readyState === "open") {
      try { ms.endOfStream(); } catch (_) {}
    }
    if (sourceUrl) URL.revokeObjectURL(sourceUrl);
    setStatus("error", "❌ Ошибка стриминга: " + e.message);
    return false;
  }
}

/* ===== Split MP4 init (ftyp+moov) from media (moof+mdat) ===== */
function splitInitSegment(uint8arr) {
  let offset = 0;
  let initEnd = 0;
  while (offset < uint8arr.length - 8) {
    const size = (uint8arr[offset] << 24) | (uint8arr[offset + 1] << 16) | (uint8arr[offset + 2] << 8) | uint8arr[offset + 3];
    const type = String.fromCharCode(uint8arr[offset + 4], uint8arr[offset + 5], uint8arr[offset + 6], uint8arr[offset + 7]);
    if (type === "moof") {
      initEnd = offset;
      break;
    }
    if (size === 0 || size > uint8arr.length - offset) break;
    offset += size;
  }
  if (initEnd > 0) {
    return {
      init: uint8arr.buffer.slice(uint8arr.byteOffset, uint8arr.byteOffset + initEnd),
      media: uint8arr.buffer.slice(uint8arr.byteOffset + initEnd, uint8arr.byteOffset + uint8arr.byteLength),
    };
  }
  // Если не нашли moof — отдаём всё как media
  return { init: new ArrayBuffer(0), media: uint8arr.buffer };
}

/* ===== Legacy Full Transcode ===== */
async function legacyFullTranscode(file) {
  const input = "input" + ext(file.name);
  const output = "output_legacy.mp4";

  console.log("=== legacyFullTranscode START ===");
  appendLog("=== legacyFullTranscode START ===");
  console.log("input=" + input + ", output=" + output);
  appendLog("input=" + input + ", output=" + output);

  updateProgress(0);
  setStatus("transcoding", "🔄 Полное транскодирование...");

  try {
    console.log("Запуск ffmpeg.exec...");
    appendLog("Запуск ffmpeg.exec...");
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
    console.log("exec завершён, читаем output...");
    appendLog("exec завершён, читаем output...");

    const data = await state.ffmpeg.readFile(output);
    const blob = new Blob([data.buffer], { type: "video/mp4" });
    state.transcodedBlobUrl = URL.createObjectURL(blob);
    els.video.src = state.transcodedBlobUrl;
    state.isTranscoded = true;

    console.log("readFile OK, размер=" + formatBytes(blob.size));
    appendLog("readFile OK, размер=" + formatBytes(blob.size));
    console.log("Blob создан, URL=" + state.transcodedBlobUrl);
    appendLog("Blob создан, URL=" + state.transcodedBlobUrl);

    showStats({
      "Имя файла": file.name,
      "Размер оригинала": formatBytes(file.size),
      "Размер после транскода": formatBytes(blob.size),
      Режим: "FFmpeg WASM legacy транскод → H.264/AAC",
    });

    setStatus("ready", "✅ Транскодировано и воспроизводится");
    setupWebgl();
    console.log("=== legacyFullTranscode SUCCESS ===");
    appendLog("=== legacyFullTranscode SUCCESS ===");
  } catch (e) {
    console.error("❌ legacyFullTranscode ERROR:", e);
    appendLog("❌ legacyFullTranscode ERROR: " + e.message);
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
