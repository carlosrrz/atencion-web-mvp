// app.js — estable: FPS/p95 propios + tabs + consentimiento + cámara
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
const tabState      = document.getElementById('tab-state');

const fpsEl   = document.getElementById('fps');
const p95El   = document.getElementById('p95');
const fpsPill = document.getElementById('fps-pill');
const p95Pill = document.getElementById('p95-pill');
const perfAll = document.getElementById('perf-overall');

// Tabs (Lectura/Video/Examen)
const tabButtons = Array.from(document.querySelectorAll('.tab'));
const sections = {
  lectura: document.getElementById('lectura'),
  video:   document.getElementById('video'),
  // si tu examen vive en #examen o #exam-root soportamos ambos
  examen:  document.getElementById('examen') || document.getElementById('exam-root'),
};

// Modal de consentimiento (opcional)
const consentBackdrop = document.getElementById('consent-backdrop');
const consentModal    = document.getElementById('consent-modal');
const consentAccept   = document.getElementById('consent-accept');
const consentCancel   = document.getElementById('consent-cancel');
const consentCheck    = document.getElementById('consent-check');
document.getElementById('open-privacy')?.addEventListener('click', (e)=>{ e.preventDefault(); showConsent(); });

// ===== Estado =====
let stream = null;
let running = false;
let camRequested = false;
let frameCount = 0;
let sessionStart = 0;

const metrics = createMetrics();       // lo seguimos llamando, pero ya no dependemos de él
const tabLogger = createTabLogger();

// ===== Utiles =====
const CONSENT_KEY = 'mvp.consent.v1';
const hasConsent = () => { try { return !!localStorage.getItem(CONSENT_KEY); } catch { return false; } };
const setConsent = () => { try { localStorage.setItem(CONSENT_KEY, JSON.stringify({v:1,ts:Date.now()})); } catch{} };
const insecureContext = () => !(location.protocol === 'https:' || location.hostname === 'localhost');

function showConsent(){
  if(!consentModal||!consentBackdrop){ alert('Para usar la cámara debes aceptar el consentimiento.'); return; }
  if (consentCheck) { consentCheck.checked = false; consentAccept && (consentAccept.disabled = true); }
  consentBackdrop.classList.remove('hidden');
  consentModal.classList.remove('hidden');
}
function hideConsent(){
  if(!consentModal||!consentBackdrop) return;
  consentBackdrop.classList.add('hidden');
  consentModal.classList.add('hidden');
}
consentCheck?.addEventListener('change', ()=>{ if(consentAccept) consentAccept.disabled = !consentCheck.checked; });
consentCancel?.addEventListener('click', hideConsent);
consentAccept?.addEventListener('click', ()=>{ setConsent(); hideConsent(); });

function setCamStatus(kind, msg, help=''){
  if(!camStatus) return;
  camStatus.className = 'pill ' + (kind==='ok'?'pill-ok':kind==='warn'?'pill-warn':kind==='err'?'pill-err':'pill-neutral');
  camStatus.textContent = msg;
  if (camHelp){
    if (help){ camHelp.textContent = help; camHelp.classList.remove('hidden'); }
    else camHelp.classList.add('hidden');
  }
}
function releaseStream(){
  try { stream?.getTracks()?.forEach(t=>t.stop()); } catch {}
  stream = null;
}

// ===== Semáforo rendimiento (RN-001) =====
const PERF = { fps:{green:24, amber:18}, p95:{green:200, amber:350} };
const levelFPS = v => v>=PERF.fps.green?'ok' : v>=PERF.fps.amber?'warn':'err';
const levelP95 = v => v<=PERF.p95.green?'ok': v<=PERF.p95.amber?'warn':'err';
function setPill(el, level, label){
  if(!el) return;
  el.classList.remove('pill-neutral','pill-ok','pill-warn','pill-err');
  el.classList.add('pill', `pill-${level}`);
  el.textContent = label;
}
const worst = (a,b)=>({ok:0,warn:1,err:2}[a] >= {ok:0,warn:1,err:2}[b] ? a : b);

// ===== Tracker propio de FPS y p95 =====
let lastFrameTs = 0;
const fpsSamples = [];     // valores de FPS por frame
const procSamples = [];    // tiempos de procesamiento (ms) por frame
const MAX_SAMPLES = 120;

function pushSample(arr, v){
  arr.push(v);
  if (arr.length > MAX_SAMPLES) arr.shift();
}
function median(arr){
  if(!arr.length) return 0;
  const a = [...arr].sort((x,y)=>x-y);
  const mid = Math.floor(a.length/2);
  return a.length%2 ? a[mid] : (a[mid-1]+a[mid])/2;
}
function percentile(arr, p=0.95){
  if(!arr.length) return 0;
  const a = [...arr].sort((x,y)=>x-y);
  const idx = Math.min(a.length-1, Math.floor(p*(a.length-1)));
  return a[idx];
}
function updatePerfUI(){
  const fpsMed = Math.round(median(fpsSamples));
  const p95    = Math.round(percentile(procSamples, 0.95)*10)/10;

  if (fpsEl) fpsEl.textContent = fpsMed;
  if (p95El) p95El.textContent = p95;

  const lf = levelFPS(fpsMed);
  const lp = levelP95(p95);
  setPill(fpsPill, lf, lf==='ok'?'🟢':lf==='warn'?'🟠':'🔴');
  setPill(p95Pill, lp, lp==='ok'?'🟢':lp==='warn'?'🟠':'🔴');
  setPill(perfAll, worst(lf,lp), worst(lf,lp)==='ok'?'🟢 Óptimo': worst(lf,lp)==='warn'?'🟠 Atención':'🔴 Riesgo');
}

// ===== Cámara =====
function syncCanvasToVideo(){
  const w = cam.videoWidth || 640;
  const h = cam.videoHeight || 360;
  canvas.width = w; canvas.height = h;
}
async function startCamera(){
  if (insecureContext()){
    setCamStatus('warn','HTTPS requerido','Abre la app en HTTPS o localhost.');
    return;
  }
  try{
    stream = await navigator.mediaDevices.getUserMedia({ video:{ width:1280, height:720 } });
    cam.srcObject = stream;
    await cam.play?.();
    if (cam.readyState >= 2) syncCanvasToVideo();
    else cam.addEventListener('loadedmetadata', syncCanvasToVideo, { once:true });

    setCamStatus('ok', `Listo (${cam.videoWidth||1280}x${cam.videoHeight||720})`, 'La cámara está activa. Puedes Iniciar la evaluación.');
  }catch(e){
    const n = e?.name || 'CameraError';
    if (n==='NotAllowedError'||n==='SecurityError') setCamStatus('err','Permiso denegado','Candado del navegador → Cámara: Permitir.');
    else if (n==='NotFoundError'||n==='OverconstrainedError') setCamStatus('err','Sin cámara','Conecta una webcam o verifica drivers.');
    else if (n==='NotReadableError') setCamStatus('warn','Cámara ocupada','Cierra Zoom/Meet/Teams y reintenta.');
    else setCamStatus('err','Error de cámara',`Detalle: ${n}`);
  }
}

// ===== Loop =====
function loop(){
  if (!running) return;

  if (cam.readyState < 2){ requestAnimationFrame(loop); return; }

  // Medición propia de procesamiento + FPS
  const tProc0 = performance.now();

  ctx.drawImage(cam, 0, 0, canvas.width, canvas.height);
  // (si luego pones inferencia, colócala entre tProc0 y tProc1)

  const tProc1 = performance.now();
  pushSample(procSamples, tProc1 - tProc0);

  if (lastFrameTs){
    const fps = 1000 / (tProc1 - lastFrameTs);
    pushSample(fpsSamples, fps);
  }
  lastFrameTs = tProc1;

  // (opcional) seguimos alimentando tu metrics.js
  try {
    const t0 = metrics.onFrameStart?.();
    metrics.onFrameEnd?.(t0 ?? tProc0);
  } catch {}

  frameCount++;
  if (frameCount % 10 === 0){
    updatePerfUI();

    // timer
    const ms = performance.now() - sessionStart;
    const s  = Math.floor(ms/1000);
    const mm = String(Math.floor(s/60)).padStart(2,'0');
    const ss = String(s%60).padStart(2,'0');
    if (sessionTime) sessionTime.textContent = `${mm}:${ss}`;

    // pestaña
    if (tabState) tabState.textContent = document.visibilityState==='visible' ? 'En pestaña' : 'Fuera de pestaña';
  }

  requestAnimationFrame(loop);
}

// ===== Handlers =====
btnPermitir?.addEventListener('click', async ()=>{
  if (!hasConsent()) { showConsent(); return; }
  camRequested = true;
  await startCamera();
});
btnRetry?.addEventListener('click', ()=>{
  releaseStream();
  setCamStatus('neutral','Permiso pendiente','Presiona “Permitir cámara” para iniciar.');
});
btnStart?.addEventListener('click', ()=>{
  if (!hasConsent()) { showConsent(); return; }
  if (!stream) { alert('Primero permite la cámara.'); return; }
  running = true;
  frameCount = 0;
  sessionStart = performance.now();
  lastFrameTs = 0;
  fpsSamples.length = 0;
  procSamples.length = 0;
  sessionStatus && (sessionStatus.textContent = 'Monitoreando');
  tabLogger.start?.();
  loop();
});
btnStop?.addEventListener('click', ()=>{
  running = false;
  sessionStatus && (sessionStatus.textContent = 'Detenida');
  tabLogger.stopAndDownloadCSV?.();
});

// Reconexion suave
document.addEventListener('visibilitychange', async ()=>{
  if (document.visibilityState==='visible' && !stream && camRequested && hasConsent()){
    await startCamera();
  }
});
navigator.mediaDevices?.addEventListener?.('devicechange', async ()=>{
  if (!stream && camRequested && hasConsent()) await startCamera();
});

// ===== Tabs (Lectura/Video/Examen) =====
function showSection(key){
  for (const k of Object.keys(sections)){
    const el = sections[k];
    if (!el) continue;
    if (k===key) el.classList.remove('hidden'); else el.classList.add('hidden');
  }
  tabButtons.forEach(b => b.classList.toggle('active', b.dataset.t===key));
}
tabButtons.forEach(btn=>{
  btn.addEventListener('click', ()=>{
    const k = btn.dataset.t;
    if (!k) return;
    showSection(k);
  });
});
// Fija sección inicial si hay una tab activa
const initialTab = tabButtons.find(b=>b.classList.contains('active'))?.dataset.t || 'lectura';
showSection(initialTab);

// ===== Estado inicial UI =====
(function init(){
  if (!navigator.mediaDevices?.getUserMedia){
    setCamStatus('err','No soportado','Usa Chrome/Edge (getUserMedia).');
    return;
  }
  if (insecureContext()){
    setCamStatus('warn','HTTPS requerido','Abre con candado (HTTPS) o en localhost.');
    return;
  }
  setCamStatus('neutral','Permiso pendiente','Presiona “Permitir cámara” para iniciar.');
  sessionStatus && (sessionStatus.textContent = 'Detenida');
  sessionTime && (sessionTime.textContent = '00:00');
  if (fpsEl) fpsEl.textContent = '0';
  if (p95El) p95El.textContent = '0.0';
})();
