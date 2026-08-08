const $=(sel)=>document.querySelector(sel);
const state={ffmpeg:null,ffmpegReady:false,currentFile:null,currentFileName:"",currentFileData:null,isTranscoded:false,transcodedBlobUrl:null,webglFilter:null,webglEnabled:false,ffmpegLazyLoaded:false};
const els={status:$("#status-bar"),diagPanel:$("#diag-panel"),diagContent:$("#diag-content"),dropZone:$("#drop-zone"),fileInput:$("#file-input"),video:$("#video-player"),canvas:$("#gl-canvas"),placeholder:$("#placeholder"),statsPanel:$("#stats-panel"),statsGrid:$("#stats-grid"),ffmpegPanel:$("#ffmpeg-panel"),btnTranscode:$("#btn-transcode"),btnThumbs:$("#btn-thumbs"),btnGif:$("#btn-gif"),btnInfo:$("#btn-info"),btnLoadFfmpeg:$("#btn-load-ffmpeg"),progress:$("#progress"),progressFill:$("#progress-fill"),progressText:$("#progress-text"),logOutput:$("#log-output"),resultPanel:$("#result-panel"),resultContent:$("#result-content"),thumbsPanel:$("#thumbs-panel"),thumbsGrid:$("#thumbs-grid"),webglPanel:$("#webgl-panel"),webglToggle:$("#webgl-toggle"),filterGrid:$("#filter-grid"),lazyPanel:$("#lazy-panel")};
const NEEDS_TRANSCODE_EXTS=new Set([".mkv",".avi",".mov",".flv",".wmv",".m2ts",".ts",".mpeg",".mpg",".3gp",".ogv",".webm"]);

function setStatus(cls,text){els.status.className="status "+cls;els.status.textContent=text;console.log("[Status]",text);}
function diag(msg){const p=document.createElement("p");p.textContent=msg;els.diagContent.appendChild(p);console.log("[Diag]",msg);}
function appendLog(msg){els.logOutput.textContent+=msg+"\n";els.logOutput.scrollTop=els.logOutput.scrollHeight;}
function updateProgress(pct,label){els.progress.style.display="flex";els.progressFill.style.width=pct+"%";els.progressText.textContent=label||pct+"%";}
function resetProgress(){els.progress.style.display="none";els.progressFill.style.width="0%";els.progressText.textContent="0%";}
function enableButtons(enabled){[els.btnTranscode,els.btnThumbs,els.btnGif,els.btnInfo].forEach(b=>b.disabled=!enabled||!state.currentFile);}

async function checkFile(url,name){try{diag("Проверка "+name+"...");const r=await fetch(url,{method:"HEAD"});if(!r.ok){diag("❌ "+name+": HTTP "+r.status);return false;}const ct=r.headers.get("content-type")||"unknown";const len=r.headers.get("content-length")||"?";diag("✅ "+name+" — "+ct+" ("+formatBytes(parseInt(len)||0)+")");return true;}catch(e){diag("❌ "+name+": "+e.message);return false;}}

function formatBytes(b){if(b===0)return"0 B";const k=1024,s=["B","KB","MB","GB"],i=Math.floor(Math.log(b)/Math.log(k));return parseFloat((b/Math.pow(k,i)).toFixed(2))+" "+s[i];}
function ext(name){const i=name.lastIndexOf(".");return i>=0?name.slice(i).toLowerCase():".mp4";}
function needsTranscode(file){const e=ext(file.name),t=file.type.toLowerCase();if(NEEDS_TRANSCODE_EXTS.has(e))return true;const c=els.video.canPlayType(t);return c===""||c==="no";}

function setupEvents(){
els.dropZone.addEventListener("click",()=>els.fileInput.click());
els.fileInput.addEventListener("change",e=>handleFile(e.target.files[0]));
els.dropZone.addEventListener("dragover",e=>{e.preventDefault();els.dropZone.classList.add("dragover");});
els.dropZone.addEventListener("dragleave",()=>els.dropZone.classList.remove("dragover"));
els.dropZone.addEventListener("drop",e=>{e.preventDefault();els.dropZone.classList.remove("dragover");const f=e.dataTransfer.files[0];if(f&&f.type.startsWith("video/"))handleFile(f);});
els.btnTranscode.addEventListener("click",transcodeToMp4);
els.btnThumbs.addEventListener("click",extractThumbnails);
els.btnGif.addEventListener("click",makeGif);
els.btnInfo.addEventListener("click",getFfmpegInfo);
els.btnLoadFfmpeg.addEventListener("click",initFfmpeg);
els.webglToggle.addEventListener("change",toggleWebGL);
document.querySelectorAll(".filter-btn").forEach(b=>b.addEventListener("click",()=>setFilter(b.dataset.filter)));
}

function toggleWebGL(){state.webglEnabled=els.webglToggle.checked;if(!state.webglEnabled){if(state.webglFilter){state.webglFilter.stop();state.webglFilter.destroy();state.webglFilter=null;}els.canvas.classList.remove("active");els.video.classList.add("active");return;}if(!state.webglFilter){try{state.webglFilter=new WebGLVideoFilter(els.canvas);state.webglFilter.setVideo(els.video);}catch(e){diag("❌ WebGL недоступен: "+e.message);els.webglToggle.checked=false;state.webglEnabled=false;return;}}els.video.classList.remove("active");els.canvas.classList.add("active");state.webglFilter.start();setStatus("webgl","🎨 WebGL режим");}

function setFilter(name){if(!state.webglFilter)return;state.webglFilter.setFilter(name);document.querySelectorAll(".filter-btn").forEach(b=>b.classList.toggle("active",b.dataset.filter===name));}

// ========== TOBLOBURL FIX ==========
// Загружает файл через fetch и возвращает blob URL.
// Решает проблему: ffmpeg-core.js (UMD) внутри Worker разрешает путь к .wasm
// относительно blob/Worker-контекста, а не от страницы.
// Blob URL работают из любого контекста без проблем путей.
async function toBlobURL(url, mimeType) {
    diag("⬇️ Загрузка " + url.split('/').pop() + "...");
    const response = await fetch(url);
    if (!response.ok) throw new Error("HTTP " + response.status);
    const blob = await response.blob();
    const blobURL = URL.createObjectURL(new Blob([blob], { type: mimeType }));
    diag("✅ " + url.split('/').pop() + " → blob URL (" + formatBytes(blob.size) + ")");
    return blobURL;
}

async function initFfmpeg(){
if(state.ffmpegReady){diag("ℹ️ FFmpeg уже загружен");return;}
setStatus("loading","Диагностика файлов...");
els.diagPanel.style.display="block";els.diagContent.innerHTML="";
els.lazyPanel.style.display="none";els.ffmpegPanel.style.display="block";

const base=location.href.replace(/\/$/,"");

// Проверяем доступность исходных файлов
const ok1=await checkFile(base+"/js/ffmpeg/ffmpeg.js","ffmpeg.js");
const ok2=await checkFile(base+"/js/ffmpeg/ffmpeg-core.js","ffmpeg-core.js");
const ok3=await checkFile(base+"/js/ffmpeg/ffmpeg-core.wasm","ffmpeg-core.wasm");

if(!ok1||!ok2||!ok3){setStatus("error","❌ Не все файлы доступны. Подождите 2 мин (кеш GitHub Pages) и обновите.");return;}

const wasmSupported=typeof WebAssembly==="object"&&typeof WebAssembly.instantiate==="function";
if(!wasmSupported){diag("❌ WebAssembly не поддерживается");setStatus("fallback","⚡ HTML5 режим (WASM не поддерживается)");return;}
diag("✅ WebAssembly поддерживается");

if(typeof FFmpegWASM==="undefined"){diag("❌ FFmpegWASM не определён");setStatus("error","❌ ffmpeg.js не загрузился");return;}
diag("✅ FFmpegWASM определён");

setStatus("loading","Загрузка FFmpeg WASM (~32MB, 1–3 мин)...");
try{
const {FFmpeg}=FFmpegWASM;
state.ffmpeg=new FFmpeg();
state.ffmpeg.on("log",({message})=>{appendLog(message);});
state.ffmpeg.on("progress",({progress})=>{updateProgress(Math.round(progress*100));});

// === FIX: toBlobURL — загружаем файлы через fetch → blob URL ===
// Это решает проблему путей в Worker на GitHub Pages в подпапке
const coreURL = await toBlobURL(base+"/js/ffmpeg/ffmpeg-core.js", "text/javascript");
const wasmURL = await toBlobURL(base+"/js/ffmpeg/ffmpeg-core.wasm", "application/wasm");

diag("Вызов ffmpeg.load({coreURL, wasmURL})...");
const t0=performance.now();

// Прогресс загрузки WASM через fetch (для toBlobURL уже показан выше)
// Но добавим прогресс для самого ffmpeg.load()
await state.ffmpeg.load({coreURL:coreURL,wasmURL:wasmURL});

const elapsed=((performance.now()-t0)/1000).toFixed(1);
state.ffmpegReady=true;
setStatus("ready","✅ FFmpeg WASM готов ("+elapsed+"с)");
els.ffmpegPanel.style.display="block";
enableButtons(true);
diag("✅ Инициализация завершена за "+elapsed+"с");
if(state.currentFile){await loadFileToFfmpeg();}
}catch(err){
console.error(err);
diag("❌ Ошибка: "+err.message);
setStatus("error","❌ "+(err.message||"FFmpeg WASM недоступен"));
appendLog("ERROR: "+err.message);
if(err.stack)appendLog("STACK: "+err.stack);
}
}

async function loadFileToFfmpeg(){if(!state.ffmpegReady||!state.currentFile)return;const inputName="input"+ext(state.currentFileName);await state.ffmpeg.writeFile(inputName,state.currentFileData);appendLog("Файл загружен в FFmpeg FS: "+inputName);}

async function handleFile(file){
if(!file)return;
state.currentFile=file;state.currentFileName=file.name;state.isTranscoded=false;
if(state.transcodedBlobUrl){URL.revokeObjectURL(state.transcodedBlobUrl);state.transcodedBlobUrl=null;}
const arrayBuffer=await file.arrayBuffer();state.currentFileData=new Uint8Array(arrayBuffer);
const needsTc=needsTranscode(file);const canPlay=els.video.canPlayType(file.type);
showStats({"Имя файла":file.name,"Размер":formatBytes(file.size),"MIME-type":file.type||"unknown","Расширение":ext(file.name),"HTML5 поддержка":canPlay||"нет","Требуется транскод":needsTc?"Да (FFmpeg WASM)":"Нет"});
els.placeholder.style.display="none";
if(state.webglEnabled&&state.webglFilter){els.canvas.classList.add("active");els.video.classList.remove("active");}else{els.video.classList.add("active");els.canvas.classList.remove("active");}

if(state.ffmpegReady){await loadFileToFfmpeg();}else if(needsTc&&!state.ffmpegLazyLoaded){els.lazyPanel.style.display="block";}

if(!needsTc){
const url=URL.createObjectURL(file);els.video.src=url;
setStatus("ready","✅ Нативное воспроизведение (HTML5)");
if(state.webglEnabled&&state.webglFilter){state.webglFilter.setVideo(els.video);state.webglFilter.start();}
}else if(state.ffmpegReady){
setStatus("transcoding","🔄 Автотранскодирование в MP4...");await autoTranscode(file);
}else{
setStatus(needsTc?"error":"ready",needsTc?"❌ Формат не поддерживается HTML5, нажмите «Загрузить FFmpeg»":"✅ Воспроизведение");
if(needsTc){els.video.style.display="none";els.placeholder.style.display="block";els.placeholder.innerHTML="<p>❌ Формат не поддерживается</p><p class='hint'>"+file.name+" — требуется FFmpeg WASM</p>";}
}
enableButtons(state.ffmpegReady);
}

async function autoTranscode(file){
const input="input"+ext(file.name);const output="output_auto.mp4";updateProgress(0);
try{
await state.ffmpeg.exec(["-i",input,"-c:v","libx264","-preset","ultrafast","-crf","23","-c:a","aac","-b:a","128k","-movflags","+faststart","-y",output]);
const data=await state.ffmpeg.readFile(output);
const blob=new Blob([data.buffer],{type:"video/mp4"});
state.transcodedBlobUrl=URL.createObjectURL(blob);
els.video.src=state.transcodedBlobUrl;state.isTranscoded=true;
showStats({"Имя файла":file.name,"Размер оригинала":formatBytes(file.size),"Размер после транскода":formatBytes(blob.size),"Режим":"FFmpeg WASM транскод → H.264/AAC"});
setStatus("ready","✅ Транскодировано и воспроизводится");
if(state.webglEnabled&&state.webglFilter){state.webglFilter.setVideo(els.video);state.webglFilter.start();}
}catch(e){appendLog("Ошибка транскода: "+e.message);setStatus("error","❌ Ошибка транскодирования");}finally{resetProgress();}
}

async function transcodeToMp4(){if(!state.ffmpegReady||!state.currentFile)return;const input="input"+ext(state.currentFileName);const output="output_manual.mp4";setStatus("transcoding","🔄 Конвертация в MP4...");updateProgress(0);els.resultPanel.style.display="none";try{await state.ffmpeg.exec(["-i",input,"-c:v","libx264","-preset","fast","-crf","23","-c:a","aac","-b:a","128k","-movflags","+faststart","-y",output]);const data=await state.ffmpeg.readFile(output);const blob=new Blob([data.buffer],{type:"video/mp4"});const url=URL.createObjectURL(blob);els.video.src=url;state.transcodedBlobUrl=url;state.isTranscoded=true;showResult(data,"video/mp4","transcoded.mp4");setStatus("ready","✅ Конвертация завершена");if(state.webglEnabled&&state.webglFilter){state.webglFilter.setVideo(els.video);state.webglFilter.start();}}catch(e){appendLog("Ошибка: "+e.message);setStatus("error","❌ Ошибка конвертации");}finally{resetProgress();}}

async function extractThumbnails(){if(!state.ffmpegReady||!state.currentFile)return;const input="input"+ext(state.currentFileName);setStatus("transcoding","🖼 Извлечение скриншотов...");updateProgress(0);els.thumbsPanel.style.display="none";els.thumbsGrid.innerHTML="";try{let duration=60;try{await state.ffmpeg.exec(["-i",input]);}catch(e){}const logText=els.logOutput.textContent;const durMatch=logText.match(/Duration: (\d+):(\d+):(\d+\.\d+)/);if(durMatch){duration=parseInt(durMatch[1])*3600+parseInt(durMatch[2])*60+parseFloat(durMatch[3]);}const count=8;const step=duration/(count+1);for(let i=1;i<=count;i++){const time=(step*i).toFixed(2);const outName="thumb_"+i+".jpg";await state.ffmpeg.exec(["-ss",String(time),"-i",input,"-vframes","1","-q:v","2","-y",outName]);const data=await state.ffmpeg.readFile(outName);const blob=new Blob([data.buffer],{type:"image/jpeg"});const url=URL.createObjectURL(blob);const div=document.createElement("div");div.className="thumb-item";div.innerHTML='<img src="'+url+'" alt=""><div class="thumb-label">'+formatTime(time)+"</div>";els.thumbsGrid.appendChild(div);updateProgress(Math.round((i/count)*100));}els.thumbsPanel.style.display="block";setStatus("ready","✅ Скриншоты готовы");}catch(e){appendLog("Ошибка: "+e.message);setStatus("error","❌ Ошибка извлечения скриншотов");}finally{resetProgress();}}

function formatTime(sec){const m=Math.floor(sec/60);const s=Math.floor(sec%60);return m+":"+s.toString().padStart(2,"0");}

async function makeGif(){if(!state.ffmpegReady||!state.currentFile)return;const input="input"+ext(state.currentFileName);const output="output.gif";setStatus("transcoding","🎞 Создание GIF...");updateProgress(0);els.resultPanel.style.display="none";try{await state.ffmpeg.exec(["-i",input,"-t","3","-vf","fps=10,scale=320:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=64[p];[s1][p]paletteuse=dither=bayer","-loop","0","-y",output]);const data=await state.ffmpeg.readFile(output);showResult(data,"image/gif","preview.gif");setStatus("ready","✅ GIF создан");}catch(e){appendLog("Ошибка: "+e.message);setStatus("error","❌ Ошибка создания GIF");}finally{resetProgress();}}

async function getFfmpegInfo(){if(!state.ffmpegReady||!state.currentFile)return;const input="input"+ext(state.currentFileName);setStatus("loading","📋 Анализ файла...");els.logOutput.textContent="";try{await state.ffmpeg.exec(["-i",input]);}catch(e){}const log=els.logOutput.textContent;const stats={};const durMatch=log.match(/Duration: ([^,]+)/);if(durMatch)stats["Длительность"]=durMatch[1].trim();const bitrateMatch=log.match(/bitrate: ([^\s]+)/);if(bitrateMatch)stats["Битрейт"]=bitrateMatch[1];const codecMatch=log.match(/Video: ([^\(]+)/);if(codecMatch)stats["Видео кодек"]=codecMatch[1].trim();const audioMatch=log.match(/Audio: ([^\(]+)/);if(audioMatch)stats["Аудио кодек"]=audioMatch[1].trim();const resMatch=log.match(/(\d{2,5}x\d{2,5})/);if(resMatch)stats["Разрешение"]=resMatch[1];const fpsMatch=log.match(/(\d+(?:\.\d+)?) fps/);if(fpsMatch)stats["FPS"]=fpsMatch[1];if(Object.keys(stats).length>0){showStats({"Имя файла":state.currentFileName,...stats,"Режим":state.isTranscoded?"Транскодировано":"Оригинал"});}setStatus("ready","✅ Информация получена");}

function showStats(stats){els.statsGrid.innerHTML="";for(const[key,val]of Object.entries(stats)){const div=document.createElement("div");div.className="stat-item";div.innerHTML='<div class="stat-label">'+key+'</div><div class="stat-value">'+val+"</div>";els.statsGrid.appendChild(div);}els.statsPanel.style.display="block";}

function showResult(data,mime,filename){const blob=new Blob([data.buffer],{type:mime});const url=URL.createObjectURL(blob);els.resultContent.innerHTML="";if(mime.startsWith("image/")){const img=document.createElement("img");img.src=url;els.resultContent.appendChild(img);}else if(mime.startsWith("video/")){const vid=document.createElement("video");vid.src=url;vid.controls=true;vid.style.maxWidth="100%";els.resultContent.appendChild(vid);}const link=document.createElement("a");link.href=url;link.download=filename;link.className="download-link";link.textContent="⬇ Скачать "+filename;els.resultContent.appendChild(link);els.resultPanel.style.display="block";}

if("serviceWorker"in navigator){navigator.serviceWorker.register("./sw.js").catch(e=>console.log("SW skip:",e));}

setupEvents();
setStatus("ready","✅ HTML5 Video готов. FFmpeg WASM загружается по требованию.");
