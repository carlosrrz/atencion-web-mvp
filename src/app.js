// app.js — MVP estable con pestaña/atención/episodios/tiempo fuera en vivo
import { createMetrics } from './metrics.js';
import { createTabLogger } from './tab-logger.js';

// ===== DOM =====
const cam = document.getElementById('cam');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

const btnPermitir = document.getElementById('btn-permitir');
const btnRetry    = document.getElementById('btn-reintentar');
const btnStart    = document.getElementById('btn-start');
const btnStop     = document.getElementById('btn-stop');

const camStatus = document.getElementById('cam-status');
const camHelp   = document.getElementById('cam-help');

const sessionStatus = document.getElementById('session-status');
const sessionTime   = document.getElementById('session-time');

// ===== NUEVO: campos a actualizar =====
const tabState  = document.getElementById('tab-state');
const attnEl    = document.getElementById('attn-state');
const offCntEl  = document.getElementById('offtab-count');
const offTimeEl = document.getElementById('offtab-time');

const fpsEl   = document.getElementById('fps');
const p95El   = document.getElementById('p95');
const fpsPill = document.getElementById('fps-pill');
const p95Pill = document.getElementById('p95-pill');
const perfAll = document.getElementById('perf-overall');

// Tabs
const tabButtons = Array.from(document.querySelectorAll('.tab'));
const sections = {
  lectura: document.getElementById('lectura'),
  video:   document.getElementById('video'),
  examen:  document.getElementById('examen') || document.getElementById('exam-root'),
};

// ===== Estado =====
let stream = null;
let running = false;
let camRequested = false;
let frameCount = 0;
let sessionStart = 0;

// pestaña/atención
let offTabStart = null;   // timestamp cuando se sale de pestaña
let offTabEpisodes = 0;   // # de episodios acumulados
let offTabAccumMs = 0;    // tiempo fuera acumulado

const metrics = createMetrics();
const tabLogger = createTabLogger();

// ===== Util =====
const CONSENT_KEY = 'mvp.consent.v1';
const hasConsent  = () => { try { return !!localStorage.getItem(CONSENT_KEY); } catch { return false; } };
const setConsent  = () => { try { localStorage.setItem(CONSENT_KEY, JSON.stringify({v:1,ts:Date.now()})); } catch {} };
const insecureContext = () => !(location.protocol === 'https:' || location.hostname === 'localhost');

function setCamStatus(kind, msg, help=''){
  if(!camStatus) return;
  camStatus.className = 'pill ' + (kind==='ok'?'pill-ok':kind==='warn'?'pill-warn':kind==='err'?'pill-err':'pill-neutral');
  camStatus.textContent = msg;
  if (camHelp){
    if (help){ camHelp.textContent = help; camHelp.classList.remove('hidden'); }
    else camHelp.classList.add('hidden');
  }
}
function releaseStream(){ try { stream?.getTracks()?.forEach(t=>t.stop()); } catch{} stream=null; }
function syncCanvasToVideo(){ const w=cam.videoWidth||640, h=cam.videoHeight||360; canvas.width=w; canvas.height=h; }
const fmtTime = (ms)=>{ const s=Math.floor(ms/1000); const mm=String(Math.floor(s/60)).padStart(2,'0'); const ss=String(s%60).padStart(2,'0'); return `${mm}:${ss}`; };

// ===== Semáforo rendimiento =====
const PERF={ fps:{green:24,amber:18}, p95:{green:200,amber:350} };
const levelFPS=v=>v>=PERF.fps.green?'ok':v>=PERF.fps.amber?'warn':'err';
const levelP95=v=>v<=PERF.p95.green?'ok':v<=PERF.p95.amber?'warn':'err';
const worst=(a,b)=>({ok:0,warn:1,err:2}[a] >= {ok:0,warn:1,err:2}[b] ? a : b);
function setPill(el, level, label){ if(!el) return; el.classList.remove('pill-neutral','pill-ok','pill-warn','pill-err'); el.classList.add('pill',`pill-${level}`); el.textContent=label; }

// tracker simple FPS/p95
let lastFrameTs=0; const fpsS=[]; const procS=[]; const MAXS=120;
const push=(a,v)=>{a.push(v); if(a.length>MAXS)a.shift();};
const median=a=>{ if(!a.length) return 0; const s=[...a].sort((x,y)=>x-y); const m=Math.floor(s.length/2); return s.length%2?s[m]:(s[m-1]+s[m])/2; };
const perc=(a,p=.95)=>{ if(!a.length) return 0; const s=[...a].sort((x,y)=>x-y); const i=Math.min(s.length-1, Math.floor(p*(s.length-1))); return s[i]; };
function updatePerfUI(){
  const fpsMed=Math.round(median(fpsS));
  const p95=Math.round(perc(procS,.95)*10)/10;
  fpsEl&&(fpsEl.textContent=fpsMed); p95El&&(p95El.textContent=p95);
  const lf=levelFPS(fpsMed), lp=levelP95(p95);
  setPill(fpsPill,lf,lf==='ok'?'🟢':lf==='warn'?'🟠':'🔴');
  setPill(p95Pill,lp,lp==='ok'?'🟢':lp==='warn'?'🟠':'🔴');
  setPill(perfAll,worst(lf,lp), worst(lf,lp)==='ok'?'🟢 Óptimo': worst(lf,lp)==='warn'?'🟠 Atención':'🔴 Riesgo');
}

// ===== Cámara =====
async function startCamera(){
  if (insecureContext()){ setCamStatus('warn','HTTPS requerido','Abre la app en HTTPS o localhost.'); return; }
  try{
    stream = await navigator.mediaDevices.getUserMedia({ video:{ width:1280, height:720 } });
    cam.srcObject = stream; await cam.play?.();
    if (cam.readyState>=2) syncCanvasToVideo();
    else cam.addEventListener('loadedmetadata', syncCanvasToVideo, {once:true});
    setCamStatus('ok',`Listo (${cam.videoWidth||1280}x${cam.videoHeight||720})`,'La cámara está activa. Puedes Iniciar.');
  }catch(e){
    const n=e?.name||'CameraError';
    if(n==='NotAllowedError'||n==='SecurityError') setCamStatus('err','Permiso denegado','Candado → Cámara: Permitir.');
    else if(n==='NotFoundError'||n==='OverconstrainedError') setCamStatus('err','Sin cámara','Conecta una webcam o verifica drivers.');
    else if(n==='NotReadableError') setCamStatus('warn','Cámara ocupada','Cierra Zoom/Meet/Teams y reintenta.');
    else setCamStatus('err','Error de cámara',`Detalle: ${n}`);
  }
}

// ===== Loop =====
function loop(){
  if (!running) return;
  if (cam.readyState < 2){ requestAnimationFrame(loop); return; }

  const t0 = performance.now();
  ctx.drawImage(cam,0,0,canvas.width,canvas.height);
  const t1 = performance.now();

  push(procS, t1-t0);
  if (lastFrameTs) push(fpsS, 1000/(t1-lastFrameTs));
  lastFrameTs = t1;

  // opcional: tus métricas
  try{ const m0=metrics.onFrameStart?.(); metrics.onFrameEnd?.(m0??t0); }catch{}

  frameCount++;
  if (frameCount % 10 === 0){
    updatePerfUI();

    // Cronómetro de sesión
    const ms = performance.now() - sessionStart;
    sessionTime && (sessionTime.textContent = fmtTime(ms));

    // ======= ACTUALIZACIONES PEDIDAS =======
    const nowVisible = (document.visibilityState === 'visible');
    tabState && (tabState.textContent = nowVisible ? 'En pestaña' : 'Fuera de pestaña');

    // Atención: 'atento', 'intermitente' (<2s fuera), 'distracción (fuera de pestaña)' (>=2s)
    let attnState = 'atento';
    if (!nowVisible){
      const hiddenFor = offTabStart ? (performance.now() - offTabStart) : 0;
      attnState = hiddenFor >= 2000 ? 'distracción (fuera de pestaña)' : 'intermitente';
    }
    attnEl && (attnEl.textContent = attnState);

    // Tiempo fuera acumulado (si sigue fuera, suma el tramo actual)
    const accum = offTabAccumMs + (offTabStart ? (performance.now() - offTabStart) : 0);
    offTimeEl && (offTimeEl.textContent = fmtTime(accum));
    offCntEl  && (offCntEl.textContent  = String(offTabEpisodes));
  }

  requestAnimationFrame(loop);
}

// ===== Pestaña: episodios y acumulado =====
document.addEventListener('visibilitychange', () => {
  if (!running) return; // solo contar durante sesión
  const now = performance.now();
  if (document.visibilityState === 'hidden') {
    // empieza un episodio
    offTabStart = now;
  } else {
    // termina episodio: si duró >=1.5s, cuenta; en todo caso suma al acumulado
    if (offTabStart != null) {
      const dur = now - offTabStart;
      if (dur >= 1500) offTabEpisodes += 1;
      offTabAccumMs += dur;
      offTabStart = null;
    }
  }
});

// ===== Handlers =====
btnPermitir?.addEventListener('click', async ()=>{
  if (!hasConsent()){ // modal opcional
    const mb=document.getElementById('consent-backdrop'), mm=document.getElementById('consent-modal');
    if (mb && mm){ mb.classList.remove('hidden'); mm.classList.remove('hidden'); }
    return;
  }
  camRequested = true;
  await startCamera();
});
btnRetry?.addEventListener('click', ()=>{ releaseStream(); setCamStatus('neutral','Permiso pendiente','Presiona “Permitir cámara”.'); });

btnStart?.addEventListener('click', ()=>{
  if (!hasConsent()){
    const mb=document.getElementById('consent-backdrop'), mm=document.getElementById('consent-modal');
    if (mb && mm){ mb.classList.remove('hidden'); mm.classList.remove('hidden'); }
    return;
  }
  if (!stream){ alert('Primero permite la cámara.'); return; }
  running = true;
  frameCount = 0;
  sessionStart = performance.now();
  lastFrameTs = 0; fpsS.length=0; procS.length=0;

  // reset pestaña/atención
  offTabStart   = (document.visibilityState === 'hidden') ? performance.now() : null;
  offTabEpisodes= 0;
  offTabAccumMs = 0;

  sessionStatus && (sessionStatus.textContent = 'Monitoreando');
  tabLogger.start?.();
  loop();
});

btnStop?.addEventListener('click', ()=>{
  // cierra episodio si sigue fuera
  if (offTabStart != null){
    const now = performance.now();
    const dur = now - offTabStart;
    if (dur >= 1500) offTabEpisodes += 1;
    offTabAccumMs += dur;
    offTabStart = null;
  }
  running = false;
  sessionStatus && (sessionStatus.textContent = 'Detenida');
  tabLogger.stopAndDownloadCSV?.();
});

// Re-apertura / dispositivos
document.addEventListener('visibilitychange', async ()=>{
  if (document.visibilityState==='visible' && !stream && camRequested && hasConsent()){
    await startCamera();
  }
});
navigator.mediaDevices?.addEventListener?.('devicechange', async ()=>{
  if (!stream && camRequested && hasConsent()) await startCamera();
});

// ===== Tabs =====
function showSection(key){
  for (const k of Object.keys(sections)){ const el=sections[k]; if(!el) continue; (k===key)?el.classList.remove('hidden'):el.classList.add('hidden'); }
  tabButtons.forEach(b => b.classList.toggle('active', b.dataset.t===key));
}
tabButtons.forEach(btn=>btn.addEventListener('click', ()=>{ const k=btn.dataset.t; if(k) showSection(k); }));
showSection(tabButtons.find(b=>b.classList.contains('active'))?.dataset.t || 'lectura');

// ===== Estado inicial =====
(function init(){
  if (!navigator.mediaDevices?.getUserMedia){ setCamStatus('err','No soportado','Usa Chrome/Edge.'); return; }
  if (insecureContext()){ setCamStatus('warn','HTTPS requerido','Abre con candado (HTTPS) o localhost.'); return; }
  setCamStatus('neutral','Permiso pendiente','Presiona “Permitir cámara”.');
  sessionStatus && (sessionStatus.textContent = 'Detenida');
  sessionTime && (sessionTime.textContent = '00:00');
  fpsEl&&(fpsEl.textContent='0'); p95El&&(p95El.textContent='0.0');
  tabState&&(tabState.textContent='—'); attnEl&&(attnEl.textContent='—');
  offCntEl&&(offCntEl.textContent='0'); offTimeEl&&(offTimeEl.textContent='00:00');
})();
