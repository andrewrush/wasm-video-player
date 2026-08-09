const $=(sel)=>document.querySelector(sel);
const state={ffmpeg:null,ffmpegReady:false,currentFile:null,currentFileName:"",currentFileData:null,isTranscoded:false,transcodedBlobUrl:null,webglFilter:null,webglEnabled:false,cancelled:false,streaming:false,html5Failed:false,preferredMode:'auto',streamingThresholdMB:64};
const els={status:$("#status-bar"),diagPanel:$("#diag-panel"),diagContent:$("#diag-content"),dropZone:$("#drop-zone"),fileInput:$("#file-input"),video:$("#video-player"),canvas:$("#gl-canvas"),placeholder:$("#placeholder"),decoderError:$("#decoder-error"),decoderMsg:$("#decoder-msg"),btnTryFfmpeg:$("#btn-try-ffmpeg"),statsPanel:$("#stats-panel"),statsGrid:$("#stats-grid"),ffmpegPanel:$("#ffmpeg-panel"),btnTranscode:$("#btn-transcode"),btnThumbs:$("#btn-thumbs"),btnGif:$("#btn-gif"),btnInfo:$("#btn-info"),btnStop:$("#btn-stop"),progress:$("#progress"),progressFill:$("#progress-fill"),progressText:$("#progress-text"),logOutput:$("#log-output"),resultPanel:$("#result-panel"),resultContent:$("#result-content"),thumbsPanel:$("#thumbs-panel"),thumbsGrid:$("#thumbs-grid"),webglPanel:$("#webgl-panel"),webglToggle:$("#webgl-toggle"),filterGrid:$("#filter-grid"),playerStage:$("#player-stage"),modeSelect:$("#mode-select"),thresholdInput:$("#threshold-input")};

function setStatus(cls,text){els.status.className="status "+cls;els.status.textContent=text;console.log("[Status]",text);}
function diag(msg){const p=document.createElement("p");p.textContent=msg;els.diagContent.appendChild(p);console.log("[Diag]",msg);}
function appendLog(msg){els.logOutput.textContent+=msg+"\n";els.logOutput.scrollTop=els.logOutput.scrollHeight;}
function updateProgress(pct,label){els.progress.style.display="flex";els.progressFill.style.width=pct+"%";els.progressText.textContent=label||pct+"%";}
function resetProgress(){els.progress.style.display="none";els.progressFill.style.width="0%";els.progressText.textContent="0%";}
function enableButtons(enabled){[els.btnTranscode,els.btnThumbs,els.btnGif,els.btnInfo].forEach(b=>b.disabled=!enabled||!state.currentFile);}

function setPlayerMode(mode){els.playerStage.dataset.mode = mode;}
function showDecoderError(msg){els.decoderMsg.textContent = msg || "Decoder closed unexpectedly";els.decoderError.style.display = "flex";setPlayerMode('placeholder');}
function hideDecoderError(){els.decoderError.style.display = "none";}

async function checkFile(url,name){try{diag("Проверка "+name+"...");const r=await fetch(url,{method:"HEAD"});if(!r.ok){diag("❌ "+name+": HTTP "+r.status);return false;}const ct=r.headers.get("content-type")||"unknown";const len=r.headers.get("content-length")||"?";diag("✅ "+name+" — "+ct+" ("+formatBytes(parseInt(len)||0)+")");return true;}catch(e){diag("❌ "+name+": "+e.message);return false;}}

function formatBytes(b){if(b===0)return"0 B";const k=1024,s=["B","KB","MB","GB"],i=Math.floor(Math.log(b)/Math.log(k));return parseFloat((b/Math.pow(k,i)).toFixed(2))+" "+s[i];}
function ext(name){const i=name.lastIndexOf(".");return i>=0?name.slice(i).toLowerCase():".mp4";}

function setupEvents(){
els.dropZone.addEventListener("click",()=>els.fileInput.click());
els.fileInput.addEventListener("change",e=>handleFile(e.target.files[0]));
els.dropZone.addEventListener("dragover",e=>{e.preventDefault();els.dropZone.classList.add("dragover");});
els.dropZone.addEventListener("dragleave",()=>els.dropZone.classList.remove("dragover"));
els.dropZone.addEventListener("drop",e=>{e.preventDefault();els.dropZone.classList.remove("dragover");const f=e.dataTransfer.files[0];if(f&&f.type.startsWith("video/"))handleFile(f);});
els.btnTranscode.addEventListener("click",()=>legacyFullTranscode(state.currentFile));
els.btnThumbs.addEventListener("click",extractThumbnails);
els.btnGif.addEventListener("click",makeGif);
els.btnInfo.addEventListener("click",getFfmpegInfo);
els.btnTryFfmpeg.addEventListener("click",tryFfmpegFallback);
els.btnStop.addEventListener("click",stopStreaming);
els.webglToggle.addEventListener("change",toggleWebGL);
if(els.modeSelect){
    els.modeSelect.addEventListener("change",e=>{state.preferredMode=e.target.value;diag("Режим: "+state.preferredMode);});
}
if(els.thresholdInput){
    els.thresholdInput.addEventListener("change",e=>{state.streamingThresholdMB=parseInt(e.target.value)||64;diag("Порог стриминга: "+state.streamingThresholdMB+" МБ");});
}
document.querySelectorAll(".filter-btn").forEach(b=>b.addEventListener("click",()=>setFilter(b.dataset.filter)));
els.video.addEventListener('error', onVideoError);
els.video.addEventListener('loadeddata', () => { hideDecoderError(); state.html5Failed = false; });
}

function onVideoError(e){
    const err = els.video.error;
    if (!err) return;
    const msgs = {1:"Прервано загрузкой",2:"Ошибка сети",3:"Ошибка декодирования",4:"Формат не поддерживается"};
    const msg = msgs[err.code] || ("Decoder error code "+err.code);
    diag("❌ HTML5 video error: "+msg);
    state.html5Failed = true;
    showDecoderError(msg);
    setStatus("error","❌ "+msg);
}

function stopStreaming(){
    state.cancelled = true;state.streaming = false;
    setStatus("ready","⏹ Остановлено пользователем");
    els.btnStop.disabled = true;
}

function toggleWebGL(){state.webglEnabled=els.webglToggle.checked;if(!state.webglEnabled){if(state.webglFilter){state.webglFilter.stop();state.webglFilter.destroy();state.webglFilter=null;}setPlayerMode('video');return;}if(!state.webglFilter){try{state.webglFilter=new WebGLVideoFilter(els.canvas);state.webglFilter.setVideo(els.video);}catch(e){diag("❌ WebGL недоступен: "+e.message);els.webglToggle.checked=false;state.webglEnabled=false;return;}}setPlayerMode('webgl');state.webglFilter.start();setStatus("webgl","🎨 WebGL режим");}

function setFilter(name){if(!state.webglFilter)return;state.webglFilter.setFilter(name);document.querySelectorAll(".filter-btn").forEach(b=>b.classList.toggle("active",b.dataset.filter===name));}

async function toBlobURL(url, mimeType) {
    diag("⬇️ Загрузка "+url.split('/').pop()+"...");
    const response = await fetch(url);
    if (!response.ok) throw new Error("HTTP "+response.status);
    const blob = await response.blob();
    const blobURL = URL.createObjectURL(new Blob([blob], {type:mimeType}));
    diag("✅ "+url.split('/').pop()+" → blob URL ("+formatBytes(blob.size)+")");
    return blobURL;
}

async function initFfmpeg(){
if(state.ffmpegReady){diag("ℹ️ FFmpeg уже загружен");return;}
setStatus("loading","Загрузка FFmpeg WASM (~32MB)...");
els.diagPanel.style.display="block";els.diagContent.innerHTML="";
els.ffmpegPanel.style.display="block";

const base=location.href.replace(/\/$/,"");
const ok1=await checkFile(base+"/js/ffmpeg/ffmpeg.js","ffmpeg.js");
const ok2=await checkFile(base+"/js/ffmpeg/ffmpeg-core.js","ffmpeg-core.js");
const ok3=await checkFile(base+"/js/ffmpeg/ffmpeg-core.wasm","ffmpeg-core.wasm");
const ok4=await checkFile(base+"/js/ffmpeg/814.ffmpeg.js","814.ffmpeg.js (Worker)");

if(!ok1||!ok2||!ok3||!ok4){setStatus("error","❌ Не все файлы доступны. Подождите 2 мин (кеш GitHub Pages) и обновите.");return;}

const wasmSupported=typeof WebAssembly==="object"&&typeof WebAssembly.instantiate==="function";
if(!wasmSupported){diag("❌ WebAssembly не поддерживается");setStatus("fallback","⚡ HTML5 режим (WASM не поддерживается)");return;}
diag("✅ WebAssembly поддерживается");

if(typeof FFmpegWASM==="undefined"){diag("❌ FFmpegWASM не определён");setStatus("error","❌ ffmpeg.js не загрузился");return;}
diag("✅ FFmpegWASM определён");

try{
const {FFmpeg}=FFmpegWASM;
state.ffmpeg=new FFmpeg();
state.ffmpeg.on("log",({message})=>{appendLog(message);});
state.ffmpeg.on("progress",({progress})=>{updateProgress(Math.round(progress*100));});

const coreURL = await toBlobURL(base+"/js/ffmpeg/ffmpeg-core.js", "text/javascript");
const wasmURL = await toBlobURL(base+"/js/ffmpeg/ffmpeg-core.wasm", "application/wasm");

diag("Вызов ffmpeg.load({coreURL, wasmURL})...");
const t0=performance.now();
await state.ffmpeg.load({coreURL:coreURL,wasmURL:wasmURL});
const elapsed=((performance.now()-t0)/1000).toFixed(1);
state.ffmpegReady=true;
setStatus("ready","✅ FFmpeg WASM готов ("+elapsed+"с)");
enableButtons(true);
diag("✅ Инициализация завершена за "+elapsed+"с");
if(state.currentFile && state.html5Failed){await tryFfmpegFallback();}
}catch(err){
console.error(err);
diag("❌ Ошибка: "+err.message);
setStatus("error","❌ "+(err.message||"FFmpeg WASM недоступен"));
appendLog("ERROR: "+err.message);
if(err.stack)appendLog("STACK: "+err.stack);
}
}

async function loadFileToFfmpeg(){if(!state.ffmpegReady||!state.currentFile)return;const inputName="input"+ext(state.currentFileName);const clone=new Uint8Array(state.currentFileData);await state.ffmpeg.writeFile(inputName,clone);appendLog("Файл загружен в FFmpeg FS: "+inputName);}

async function handleFile(file){
if(!file)return;
state.currentFile=file;state.currentFileName=file.name;state.isTranscoded=false;state.html5Failed=false;state.cancelled=false;
hideDecoderError();
if(state.transcodedBlobUrl){URL.revokeObjectURL(state.transcodedBlobUrl);state.transcodedBlobUrl=null;}
const arrayBuffer=await file.arrayBuffer();state.currentFileData=new Uint8Array(arrayBuffer);

showStats({"Имя файла":file.name,"Размер":formatBytes(file.size),"MIME-type":file.type||"unknown","Расширение":ext(file.name)});

setPlayerMode('video');
const url=URL.createObjectURL(file);
els.video.src=url;
els.video.play().catch(e=>console.log('Autoplay blocked:',e));
setStatus("ready","🎬 Пробуем HTML5 воспроизведение...");

if(!state.ffmpegReady && !state.ffmpegLoading){
    state.ffmpegLoading = true;
    initFfmpeg().then(()=>{state.ffmpegLoading=false;});
}
if(state.ffmpegReady){await loadFileToFfmpeg();}
enableButtons(state.ffmpegReady);
}

async function tryFfmpegFallback(){
    diag("=== tryFfmpegFallback START ===");
    try{
        if(!state.currentFile){diag("❌ Нет currentFile");return;}
        if(!state.ffmpegReady){
            diag("⏳ Ожидание FFmpeg...");
            els.decoderMsg.textContent = "Загрузка FFmpeg WASM, подождите...";
            for(let i=0;i<120 && !state.ffmpegReady;i++){await new Promise(r=>setTimeout(r,500));}
            if(!state.ffmpegReady){diag("❌ FFmpeg не загрузился");els.decoderMsg.textContent="FFmpeg не загрузился. Проверьте соединение.";return;}
        }
        diag("✅ FFmpeg готов");
        hideDecoderError();
        setPlayerMode('video');
        els.video.pause();
        diag("Загрузка файла в FFmpeg...");
        await loadFileToFfmpeg();
        diag("✅ Файл в FFmpeg");

        const thresholdBytes = state.streamingThresholdMB * 1024 * 1024;
        const useStreaming = state.preferredMode === 'streaming' ||
            (state.preferredMode === 'auto' && state.currentFile.size >= thresholdBytes);

        diag("Режим="+state.preferredMode+", размер="+formatBytes(state.currentFile.size)+", порог="+state.streamingThresholdMB+"MB → "+(useStreaming?"стриминг":"legacy"));

        if(useStreaming){
            setStatus("transcoding","🔄 Потоковая обработка...");
            els.btnStop.disabled = false;
            state.cancelled = false; state.streaming = true;
            try{
                const started = await streamingPipeline(state.currentFile);
                if(!started){
                    diag("⚠️ Стриминг не дал результата, fallback на legacy...");
                    await legacyFullTranscode(state.currentFile);
                }
            }catch(e){
                diag("❌ Ошибка стриминга: "+(e&&e.message?e.message:String(e)));
                await legacyFullTranscode(state.currentFile);
            }finally{
                state.streaming = false;
                els.btnStop.disabled = true;
            }
        }else{
            setStatus("transcoding","🔄 Транскодирование (legacy)...");
            await legacyFullTranscode(state.currentFile);
        }
    }catch(e){
        diag("❌ tryFfmpegFallback EXCEPTION: "+(e&&e.message?e.message:String(e)));
        console.error(e);
        setStatus("error","❌ Ошибка fallback: "+(e&&e.message?e.message:String(e)));
    }
    diag("=== tryFfmpegFallback END ===");
}

async function sniffCodecs(file){
    const chunk = new Uint8Array(await file.slice(0, 2*1024*1024).arrayBuffer());
    const text = new TextDecoder('ascii',{fatal:false}).decode(chunk);
    if(chunk.length>=4 && chunk[0]===0x1A && chunk[1]===0x45 && chunk[2]===0xDF && chunk[3]===0xA3){
        const hasH264=text.includes('V_MPEG4/ISO/AVC');
        const hasAAC=text.includes('A_AAC');
        const hasHEVC=text.includes('V_MPEGH/ISO/HEVC');
        const hasAV1=text.includes('V_AV1');
        const hasVP9=text.includes('V_VP9');
        if(hasH264&&hasAAC) return {copy:true, codecs:'video/mp4; codecs="avc1.42E01E, mp4a.40.2"'};
        if(hasVP9) return {copy:true, codecs:'video/mp4; codecs="vp09.00.10.08, mp4a.40.2"'};
        if(hasAV1) return {copy:true, codecs:'video/mp4; codecs="av01.0.04M.08, mp4a.40.2"'};
        if(hasHEVC) return {copy:false};
        return {copy:false};
    }
    if(text.includes('ftyp')||text.includes('moov')){
        const hasAVC=text.includes('avc1')||text.includes('AVC1');
        const hasAAC=text.includes('mp4a')||text.includes('AAC');
        const hasHEVC=text.includes('hvc1')||text.includes('hev1');
        if(hasHEVC) return {copy:false};
        if(hasAVC&&hasAAC) return {copy:true, codecs:'video/mp4; codecs="avc1.42E01E, mp4a.40.2"'};
        if(hasAVC) return {copy:true, codecs:'video/mp4; codecs="avc1.42E01E, mp4a.40.2"'};
        return {copy:false};
    }
    if(text.includes('RIFF')&&text.includes('AVI ')){
        const hasH264=text.includes('H264')||text.includes('AVC1')||text.includes('avc1');
        const hasAAC=text.includes('AAC');
        const hasXVID=text.includes('XVID')||text.includes('xvid');
        const hasDIVX=text.includes('DIVX')||text.includes('divx');
        const hasMJPG=text.includes('MJPG')||text.includes('mjpg');
        if(hasH264&&hasAAC) return {copy:true, codecs:'video/mp4; codecs="avc1.42E01E, mp4a.40.2"'};
        if(hasXVID||hasDIVX||hasMJPG) return {copy:false};
        return {copy:false};
    }
    return {copy:false};
}

function splitInitAndSeg(u8){
    let i=0;
    while(i+8<=u8.length){
        const size=(u8[i]<<24|u8[i+1]<<16|u8[i+2]<<8|u8[i+3])>>>0;
        const type=String.fromCharCode(u8[i+4],u8[i+5],u8[i+6],u8[i+7]);
        if(type==='moof') return {init:u8.slice(0,i), seg:u8.slice(i)};
        i+=size>0?size:8;
    }
    return {init:u8, seg:new Uint8Array(0)};
}

function appendQ(sb, buf){
    return new Promise((res,rej)=>{
        const fail=()=>rej(sb.error||new Error('SourceBuffer error'));
        sb.addEventListener('error', fail, {once:true});
        const go=()=>{sb.onupdateend=()=>{sb.removeEventListener('error',fail);res();};sb.appendBuffer(buf);};
        sb.updating?sb.addEventListener('updateend',go,{once:true}):go();
    });
}

async function streamingPipeline(file, retryTranscode=false){
    diag("=== streamingPipeline START ===");

    if(typeof MediaSource === 'undefined'){
        diag("❌ MediaSource не поддерживается");
        return false;
    }

    let ms, msUrl, sb;
    try{
        diag("[SP] new MediaSource()");
        ms=new MediaSource();
        diag("[SP] createObjectURL");
        msUrl=URL.createObjectURL(ms);
        diag("[SP] video.src = msUrl");
        els.video.src=msUrl;
        diag("[SP] await sourceopen");
        await new Promise((resolve, reject) => {
            ms.onsourceopen = () => resolve();
            setTimeout(() => reject(new Error('sourceopen timeout')), 10000);
        });
        diag("[SP] sourceopen OK");

        let copy=false;
        let codecsStr='video/mp4; codecs="avc1.42E01E, mp4a.40.2"';

        if(!retryTranscode){
            diag("[SP] sniffCodecs");
            const sniffed=await sniffCodecs(file);
            copy=sniffed.copy;
            if(copy&&sniffed.codecs) codecsStr=sniffed.codecs;
            diag("[SP] sniffCodecs OK, copy="+copy);
        }
        const sbCodecs=copy?codecsStr:'video/mp4; codecs="avc1.42E01E, mp4a.40.2"';
        diag("[SP] addSourceBuffer: "+sbCodecs);

        try{sb=ms.addSourceBuffer(sbCodecs);diag("[SP] addSourceBuffer OK");}
        catch(e){
            diag("[SP] addSourceBuffer FAILED: "+(e&&e.message?e.message:String(e)));
            if(copy&&!retryTranscode){
                diag('⚠️ Copy-путь не сработал, пробуем транскод...');
                try{ms.endOfStream();}catch{}
                URL.revokeObjectURL(msUrl);
                return streamingPipeline(file,true);
            }
            throw e;
        }

        const IN='input'+ext(file.name);
        const ARGS=copy?['-c','copy']:['-c:v','libx264','-preset','ultrafast','-crf','23','-c:a','aac','-b:a','128k'];
        const D=copy?60:10;
        diag("[SP] IN="+IN+", D="+D);

        let started=false;
        for(let T=0;!state.cancelled;T+=D){
            diag("[SP] === Чанк T="+T+" ===");
            let segU8;
            try{
                diag("[SP] exec...");
                await state.ffmpeg.exec(['-ss',String(T),'-i',IN,'-t',String(D),...ARGS,'-f','mp4','-movflags','frag_keyframe+empty_moov','/seg.mp4']);
                diag("[SP] exec OK");
            }catch(e){
                const errMsg=(e&&e.message)?e.message:(typeof e==='string'?e:String(e));
                diag("[SP] exec FAILED: "+errMsg);
                break;
            }

            try{
                diag("[SP] readFile /seg.mp4...");
                segU8=new Uint8Array(await state.ffmpeg.readFile('/seg.mp4'));
                diag("[SP] readFile OK, "+formatBytes(segU8.length));
            }catch(e){
                const errMsg=(e&&e.message)?e.message:(typeof e==='string'?e:String(e));
                diag("[SP] readFile FAILED: "+errMsg);
                break;
            }

            try{
                diag("[SP] deleteFile /seg.mp4...");
                await state.ffmpeg.deleteFile('/seg.mp4');
                diag("[SP] deleteFile OK");
            }catch(e){
                const errMsg=(e&&e.message)?e.message:(typeof e==='string'?e:String(e));
                diag("[SP] deleteFile FAILED: "+errMsg);
            }

            if(!segU8||segU8.length<200){diag("[SP] Чанк слишком мал, конец");break;}

            const {init,seg}=splitInitAndSeg(segU8);
            diag("[SP] split: init="+init.length+", seg="+seg.length);
            if(!started){await appendQ(sb,init);started=true;diag("[SP] init appended");}
            if(!copy){sb.timestampOffset=T;diag("[SP] timestampOffset="+T);}
            if(seg.length){await appendQ(sb,seg);diag("[SP] seg appended");}
            if(els.video.paused){els.video.play().catch(()=>{});}
            updateProgress(0,`Обработано ~${T+D} с`);
            setStatus('transcoding',`🔄 Обработано ~${T+D} с`);
        }
        if(started){try{ms.endOfStream();}catch{}}
        diag("=== streamingPipeline END, started="+started+" ===");
        return started;
    }catch(e){
        const errMsg=(e&&e.message)?e.message:(typeof e==='string'?e:JSON.stringify(e));
        diag("❌ streamingPipeline EXCEPTION: "+errMsg);
        console.error("streamingPipeline exception:",e);
        throw e;
    }
}

async function legacyFullTranscode(file){
    diag("=== legacyFullTranscode START ===");
    if(!file){diag("❌ Нет файла");return;}
    const input="input"+ext(file.name);
    const output="output_legacy.mp4";
    diag("input="+input+", output="+output);
    updateProgress(0);
    try{
        diag("Запуск ffmpeg.exec...");
        await state.ffmpeg.exec(["-i",input,"-c:v","libx264","-preset","ultrafast","-crf","23","-c:a","aac","-b:a","128k","-movflags","+faststart","-y",output]);
        diag("exec завершён, читаем output...");
        const data=await state.ffmpeg.readFile(output);
        diag("readFile OK, размер="+formatBytes(data.length));
        const blob=new Blob([data.buffer],{type:"video/mp4"});
        state.transcodedBlobUrl=URL.createObjectURL(blob);
        diag("Blob создан, URL="+state.transcodedBlobUrl);
        setPlayerMode('video');
        els.video.src=state.transcodedBlobUrl;state.isTranscoded=true;
        els.video.play().catch(e=>console.log('Autoplay blocked:',e));
        showStats({"Имя файла":file.name,"Размер оригинала":formatBytes(file.size),"Размер после транскода":formatBytes(blob.size),"Режим":"FFmpeg WASM legacy транскод → H.264/AAC"});
        setStatus("ready","✅ Транскодировано и воспроизводится");
        if(state.webglEnabled&&state.webglFilter){state.webglFilter.setVideo(els.video);state.webglFilter.start();}
        diag("=== legacyFullTranscode SUCCESS ===");
    }catch(e){
        diag("❌ Ошибка legacy транскода: "+(e&&e.message?e.message:String(e)));
        appendLog("Ошибка legacy транскода: "+(e&&e.message?e.message:String(e)));
        setStatus("error","❌ Ошибка транскодирования");
        diag("=== legacyFullTranscode FAILED ===");
    }finally{resetProgress();}
}

async function transcodeToMp4(){if(!state.ffmpegReady||!state.currentFile)return;const input="input"+ext(state.currentFileName);const output="output_manual.mp4";setStatus("transcoding","🔄 Конвертация в MP4...");updateProgress(0);els.resultPanel.style.display="none";try{await state.ffmpeg.exec(["-i",input,"-c:v","libx264","-preset","fast","-crf","23","-c:a","aac","-b:a","128k","-movflags","+faststart","-y",output]);const data=await state.ffmpeg.readFile(output);const blob=new Blob([data.buffer],{type:"video/mp4"});const url=URL.createObjectURL(blob);setPlayerMode('video');els.video.src=url;state.transcodedBlobUrl=url;state.isTranscoded=true;els.video.play().catch(e=>console.log('Autoplay blocked:',e));showResult(data,"video/mp4","transcoded.mp4");setStatus("ready","✅ Конвертация завершена");if(state.webglEnabled&&state.webglFilter){state.webglFilter.setVideo(els.video);state.webglFilter.start();}}catch(e){appendLog("Ошибка: "+(e&&e.message?e.message:String(e)));setStatus("error","❌ Ошибка конвертации");}finally{resetProgress();}}

async function extractThumbnails(){if(!state.ffmpegReady||!state.currentFile)return;const input="input"+ext(state.currentFileName);setStatus("transcoding","🖼 Извлечение скриншотов...");updateProgress(0);els.thumbsPanel.style.display="none";els.thumbsGrid.innerHTML="";try{let duration=60;try{await state.ffmpeg.exec(["-i",input]);}catch(e){}const logText=els.logOutput.textContent;const durMatch=logText.match(/Duration: (\d+):(\d+):(\d+\.\d+)/);if(durMatch){duration=parseInt(durMatch[1])*3600+parseInt(durMatch[2])*60+parseFloat(durMatch[3]);}const count=8;const step=duration/(count+1);for(let i=1;i<=count;i++){const time=(step*i).toFixed(2);const outName="thumb_"+i+".jpg";await state.ffmpeg.exec(["-ss",String(time),"-i",input,"-vframes","1","-q:v","2","-y",outName]);const data=await state.ffmpeg.readFile(outName);const blob=new Blob([data.buffer],{type:"image/jpeg"});const url=URL.createObjectURL(blob);const div=document.createElement("div");div.className="thumb-item";div.innerHTML='<img src="'+url+'" alt=""><div class="thumb-label">'+formatTime(time)+"</div>";els.thumbsGrid.appendChild(div);updateProgress(Math.round((i/count)*100));}els.thumbsPanel.style.display="block";setStatus("ready","✅ Скриншоты готовы");}catch(e){appendLog("Ошибка: "+(e&&e.message?e.message:String(e)));setStatus("error","❌ Ошибка извлечения скриншотов");}finally{resetProgress();}}

function formatTime(sec){const m=Math.floor(sec/60);const s=Math.floor(sec%60);return m+":"+s.toString().padStart(2,"0");}

async function makeGif(){if(!state.ffmpegReady||!state.currentFile)return;const input="input"+ext(state.currentFileName);const output="output.gif";setStatus("transcoding","🎞 Создание GIF...");updateProgress(0);els.resultPanel.style.display="none";try{await state.ffmpeg.exec(["-i",input,"-t","3","-vf","fps=10,scale=320:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=64[p];[s1][p]paletteuse=dither=bayer","-loop","0","-y",output]);const data=await state.ffmpeg.readFile(output);showResult(data,"image/gif","preview.gif");setStatus("ready","✅ GIF создан");}catch(e){appendLog("Ошибка: "+(e&&e.message?e.message:String(e)));setStatus("error","❌ Ошибка создания GIF");}finally{resetProgress();}}

async function getFfmpegInfo(){if(!state.ffmpegReady||!state.currentFile)return;const input="input"+ext(state.currentFileName);setStatus("loading","📋 Анализ файла...");els.logOutput.textContent="";try{await state.ffmpeg.exec(["-i",input]);}catch(e){}const log=els.logOutput.textContent;const stats={};const durMatch=log.match(/Duration: ([^,]+)/);if(durMatch)stats["Длительность"]=durMatch[1].trim();const bitrateMatch=log.match(/bitrate: ([^\s]+)/);if(bitrateMatch)stats["Битрейт"]=bitrateMatch[1];const codecMatch=log.match(/Video: ([^\(]+)/);if(codecMatch)stats["Видео кодек"]=codecMatch[1].trim();const audioMatch=log.match(/Audio: ([^\(]+)/);if(audioMatch)stats["Аудио кодек"]=audioMatch[1].trim();const resMatch=log.match(/(\d{2,5}x\d{2,5})/);if(resMatch)stats["Разрешение"]=resMatch[1];const fpsMatch=log.match(/(\d+(?:\.\d+)?) fps/);if(fpsMatch)stats["FPS"]=fpsMatch[1];if(Object.keys(stats).length>0){showStats({"Имя файла":state.currentFileName,...stats,"Режим":state.isTranscoded?"Транскодировано":"Оригинал"});}setStatus("ready","✅ Информация получена");}

function showStats(stats){els.statsGrid.innerHTML="";for(const[key,val]of Object.entries(stats)){const div=document.createElement("div");div.className="stat-item";div.innerHTML='<div class="stat-label">'+key+'</div><div class="stat-value">'+val+"</div>";els.statsGrid.appendChild(div);}els.statsPanel.style.display="block";}

function showResult(data,mime,filename){const blob=new Blob([data.buffer],{type:mime});const url=URL.createObjectURL(blob);els.resultContent.innerHTML="";if(mime.startsWith("image/")){const img=document.createElement("img");img.src=url;els.resultContent.appendChild(img);}else if(mime.startsWith("video/")){const vid=document.createElement("video");vid.src=url;vid.controls=true;vid.style.maxWidth="100%";els.resultContent.appendChild(vid);}const link=document.createElement("a");link.href=url;link.download=filename;link.className="download-link";link.textContent="⬇ Скачать "+filename;els.resultContent.appendChild(link);els.resultPanel.style.display="block";}

if("serviceWorker"in navigator){navigator.serviceWorker.register("./sw.js").catch(e=>console.log("SW skip:",e));}

setupEvents();
setStatus("ready","✅ Готов. Загрузите видео — пробуем HTML5, при ошибке → FFmpeg.");

state.ffmpegLoading=true;
initFfmpeg().then(()=>{state.ffmpegLoading=false;});
