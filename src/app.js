// app.js — cámara + métricas + pestañas + atención (yaw/blink) con MediaPipe
import { createMetrics } from './metrics.js';
import { createTabLogger } from './tab-logger.js';

// ========= NUEVO: FaceLandmarker desde CDN =========
import {
  FaceLandmarker,
  FilesetResolver,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3";

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

// NUEVO: campos de atención
const attnEl  = document.getElementById('attn-state');
const yawEl   = document.getElementById('yaw');
const blinkEl = document.getElementById('blink');

// Tabs
const tabButtons = Array.from(document.querySelectorAll('.tab'));
const sections = {
  lectura: document.getElementById('lectura'),
  video:   document.getElementById('video'),
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

const metrics = createMetrics();
const tabLogger = createTabLogger();

// ========= Consentimiento =========
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

// ========= UI helpers =========
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
function syncCanvasToVideo(){
  const w = cam.videoWidth || 640;
  const h = cam.videoHeight || 360;
  canvas.width = w; canvas.height = h;
}

// ========= Semáforo rendimiento (RN-001) =========
const PERF = { fps:{green:24, amber:18}, p95:{green:200, amber:350} };
const levelFPS = v => v>=PERF.fps.green?'ok' : v>=PERF.fps.amber?'warn':'err';
const levelP95 = v => v<=PERF.p95.green?'ok': v<=PERF.p95.amber?'warn':'err';
function setPill(el, level, label){
  if(!el) return;
  el.classList.remove('pill-neutral','pill-ok','pill-warn','pill-err');
  el.classList.add('pill', `pill-${level}`);
  el.textContent = label;
}
const worst = (a,b)=>({ok:0,warn:1,err:2}[a] >= {ok:0,warn:1,err:2}[b] ? a : b;

// ========= Tracker propio FPS / p95 =========
let lastFrameTs = 0;
const fpsSamples  = [];
const procSamples = [];
const MAX_SAMPLES = 120;
const pushSample  = (arr,v)=>{ arr.push(v); if(arr.length>MAX_SAMPLES) arr.shift(); };
const median      = arr => { if(!arr.length) return 0; const a=[...arr].sort((x,y)=>x-y); const m=Math.floor(a.length/2); return a.length%2?a[m]:(a[m-1]+a[m])/2; };
const percentile  = (arr,p=.95)=>{ if(!arr.length) return 0; const a=[...arr].sort((x,y)=>x-y); const i=Math.min(a.length-1, Math.floor(p*(a.length-1))); return a[i]; };
function updatePerfUI(){
  const fpsMed = Math.round(median(fpsSamples));
  const p95    = Math.round(percentile(procSamples,0.95)*10)/10;
  if (fpsEl) fpsEl.textContent = fpsMed;
  if (p95El) p95El.textContent = p95;
  const lf = levelFPS(fpsMed);
  const lp = levelP95(p95);
  setPill(fpsPill, lf, lf==='ok'?'🟢':lf==='warn'?'🟠':'🔴');
  setPill(p95Pill, lp, lp==='ok'?'🟢':lp==='warn'?'🟠':'🔴');
  setPill(perfAll, worst(lf,lp), worst(lf,lp)==='ok'?'🟢 Óptimo': worst(lf,lp)==='warn'?'🟠 Atención':'🔴 Riesgo');
}

// ========= NUEVO: FaceLandmarker (yaw + blink + atención) =========
let landmarker = null;
let lastVideoTime = -1;
const DETECT_EVERY = 3;     // corre cada 3 frames

// anti-rebote / estados
let eyesClosedSince = null;
let headOffSince    = null;

async function ensureLandmarker(){
  if (landmarker) return;
  try {
    const base = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm";
    const fileset = await FilesetResolver.forVisionTasks(base);
    landmarker = await FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: `${base}/face_landmarker.task` },
      runningMode: "VIDEO",
      numFaces: 1,
      outputFaceBlendshapes: true
    });
  } catch (e) {
    console.warn('FaceLandmarker no disponible:', e);
  }
}

function catScore(cats, name){
  const c = cats?.find(x => x.categoryName === name);
  return c ? c.score : 0;
}

function estimateYawDeg(lm, cats){
  // Si existe blendshape de yaw, úsalo (0..1 centrado en ~0.5)
  const yawBS = catScore(cats, 'headYaw');
  if (yawBS) return Math.round((yawBS - 0.5) * 90);

  // Fallback geométrico: posición de la nariz vs centro del rostro
  const xs = lm.map(p=>p.x);
  const minx = Math.min(...xs), maxx = Math.max(...xs);
  const cx   = (minx + maxx) / 2;
  const nose = lm[1] || lm[4] || lm[0]; // aproximación robusta
  const offset = (nose.x - cx) / (maxx - minx + 1e-6);
  return Math.round(offset * 90);
}

function updateAttention(yawDeg, blinkProb){
  const now = performance.now();
  // ojos cerrados si prob >= 0.6 sostenido > 600 ms
  if (blinkProb >= 0.6) {
    if (!eyesClosedSince) eyesClosedSince = now;
  } else eyesClosedSince = null;

  // cabeza fuera si |yaw| > 20º sostenido > 1000 ms
  if (Math.abs(yawDeg) > 20) {
    if (!headOffSince) headOffSince = now;
  } else headOffSince = null;

  let state = 'atento';
  if (document.visibilityState !== 'visible') state = 'fuera de pestaña';
  else if (eyesClosedSince && now - eyesClosedSince > 600) state = 'ojos cerrados';
  else if (headOffSince && now - headOffSince > 1000) state = 'cabeza fuera';

  attnEl && (attnEl.textContent = state);
}

function runLandmarker(){
  if (!landmarker) return;

  const ts = performance.now();
  if (cam.currentTime === lastVideoTime) return; // mismo frame
  lastVideoTime = cam.currentTime;

  const res = landmarker.detectForVideo(cam, ts);
  const lm  = res?.faceLandmarks?.[0];
  const cats = res?.faceBlendshapes?.[0]?.categories || [];

  if (!lm){
    yawEl  && (yawEl.textContent = '—');
    blinkEl&& (blinkEl.textContent= '—');
    attnEl && (attnEl.textContent = '—');
    eyesClosedSince = null; headOffSince = null;
    return;
  }

  const blinkL = catScore(cats, 'eyeBlinkLeft');
  const blinkR = catScore(cats, 'eyeBlinkRight');
  const blinkProb = (blinkL + blinkR) / 2;

  const yawDeg = estimateYawDeg(lm, cats);

  yawEl   && (yawEl.textContent   = String(yawDeg));
  blinkEl && (blinkEl.textContent = blinkProb.toFixed(2));

  updateAttention(yawDeg, blinkProb);
}

// ========= Cámara =========
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

    // cargar detector en paralelo
    ensureLandmarker();
  }catch(e){
    const n = e?.name || 'CameraError';
    if (n==='NotAllowedError'||n==='SecurityError') setCamStatus('err','Permiso denegado','Candado del navegador → Cámara: Permitir.');
    else if (n==='NotFoundError'||n==='OverconstrainedError') setCamStatus('err','Sin cámara','Conecta una webcam o verifica drivers.');
    else if (n==='NotReadableError') setCamStatus('warn','Cámara ocupada','Cierra Zoom/Meet/Teams y reintenta.');
    else setCamStatus('err','Error de cámara',`Detalle: ${n}`);
  }
}

// ========= Loop =========
function loop(){
  if (!running) return;
  if (cam.readyState < 2){ requestAnimationFrame(loop); return; }

  const t0 = performance.now();
  ctx.drawImage(cam, 0, 0, canvas.width, canvas.height);
  const t1 = performance.now();

  // métricas propias
  pushSample(procSamples, t1 - t0);
  if (lastFrameTs){ pushSample(fpsSamples, 1000 / (t1 - lastFrameTs)); }
  lastFrameTs = t1;

  // también alimenta tu metrics.js (opcional)
  try {
    const m0 = metrics.onFrameStart?.();
    metrics.onFrameEnd?.(m0 ?? t0);
  } catch {}

  frameCount++;
  if (frameCount % 10 === 0) {
    updatePerfUI();

    const ms = performance.now() - sessionStart;
    const s  = Math.floor(ms/1000);
    const mm = String(Math.floor(s/60)).padStart(2,'0');
    const ss = String(s%60).padStart(2,'0');
    sessionTime && (sessionTime.textContent = `${mm}:${ss}`);
    tabState && (tabState.textContent = document.visibilityState==='visible' ? 'En pestaña' : 'Fuera de pestaña');
  }

  // correr detección cada N frames
  if (landmarker && frameCount % DETECT_EVERY === 0) {
    runLandmarker();
  }

  requestAnimationFrame(loop);
}

// ========= Handlers =========
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
  eyesClosedSince = null; headOffSince = null;
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

// ========= Tabs =========
function showSection(key){
  for (const k of Object.keys(sections)){
    const el = sections[k];
    if (!el) continue;
    if (k===key) el.classList.remove('hidden'); else el.classList.add('hidden');
  }
  tabButtons.forEach(b => b.classList.toggle('active', b.dataset.t===key));
}
tabButtons.forEach(btn=>{
  btn.addEventListener('click', ()=>{ const k = btn.dataset.t; if (k) showSection(k); });
});
const initialTab = tabButtons.find(b=>b.classList.contains('active'))?.dataset.t || 'lectura';
showSection(initialTab);

// ========= Estado inicial =========
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
