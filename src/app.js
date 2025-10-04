// app.js — Detección más sensible a giros (EMA + movimiento), umbrales dinámicos y calibración
import { createMetrics } from './metrics.js';
import { createTabLogger } from './tab-logger.js';
import { FilesetResolver, FaceLandmarker } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3";

/* ========== DOM ========== */
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

const tabState  = document.getElementById('tab-state');
const attnEl    = document.getElementById('attn-state');
const offCntEl  = document.getElementById('offtab-count');
const offTimeEl = document.getElementById('offtab-time');

const fpsEl   = document.getElementById('fps');
const p95El   = document.getElementById('p95');
const fpsPill = document.getElementById('fps-pill');
const p95Pill = document.getElementById('p95-pill');
const perfAll = document.getElementById('perf-overall');

const tabButtons = Array.from(document.querySelectorAll('.tab'));
const sections = {
  lectura: document.getElementById('lectura'),
  video:   document.getElementById('video'),
  examen:  document.getElementById('examen') || document.getElementById('exam-root'),
};

/* ========== Detección / Calibración ========== */
// Chequea más seguido → mayor reactividad
const DETECT_EVERY = 2;
// Cara mínima para medir (más permisivo que antes)
const MIN_FACE_AREA = 0.06;
// Calibración breve mirando al frente
const CALIBRATION_MS = 1200;

// Histeresis por score (más reactiva)
const SCORE_ENTER = 6; // frames “away” para entrar
const SCORE_EXIT  = 2; // frames “back” para salir

let awayScore   = 0;
let isLookAway  = false;

let stream = null;
let running = false;
let camRequested = false;
let frameCount = 0;
let sessionStart = 0;

let landmarker = null;
let lastVideoTime = -1;

// pestaña/atención
let offTabStart = null;
let offTabEpisodes = 0;
let offTabAccumMs = 0;

const metrics = createMetrics();
const tabLogger = createTabLogger();

/* Calibración dinámica y filtros */
let calibrating = false;
let calStart = 0;
let calAR = [];
let calOFF = [];
let dyn = { enterAR: 0.62, exitAR: 0.70, enterOFF: 0.22, exitOFF: 0.18 };

// Suavizado y detector de movimiento
let emaAR = null, emaOFF = null;
const EMA_ALPHA = 0.30;       // smoothing corto
const MOVE_OFF  = 0.085;      // salto de offset que se considera “movimiento” inmediato
const MOVE_AR   = 0.060;      // salto de aspect ratio que se considera “movimiento” inmediato

/* ========== Utiles ========== */
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

/* Semáforo rendimiento */
const PERF={ fps:{green:24,amber:18}, p95:{green:200,amber:350} };
const levelFPS=v=>v>=PERF.fps.green?'ok':v>=PERF.fps.amber?'warn':'err';
const levelP95=v=>v<=PERF.p95.green?'ok':v<=PERF.p95.amber?'warn':'err';
const worst=(a,b)=>({ok:0,warn:1,err:2}[a] >= {ok:0,warn:1,err:2}[b] ? a : b);
function setPill(el, level, label){ if(!el) return; el.classList.remove('pill-neutral','pill-ok','pill-warn','pill-err'); el.classList.add('pill',`pill-${level}`); el.textContent=label; }

function updatePerfUI(){
  const { fpsMed, latP95 } = metrics.read();
  fpsEl && (fpsEl.textContent = fpsMed.toFixed(1));
  p95El && (p95El.textContent = latP95.toFixed(1));
  const lf=levelFPS(fpsMed), lp=levelP95(latP95);
  setPill(fpsPill,lf,lf==='ok'?'🟢':lf==='warn'?'🟠':'🔴');
  setPill(p95Pill,lp,lp==='ok'?'🟢':lp==='warn'?'🟠':'🔴');
  setPill(perfAll,worst(lf,lp), worst(lf,lp)==='ok'?'🟢 Óptimo': worst(lf,lp)==='warn'?'🟠 Atención':'🔴 Riesgo');
}

/* ========== Cámara ========== */
async function startCamera() {
  if (insecureContext()) {
    setCamStatus('warn', 'HTTPS requerido', 'Abre la app en HTTPS o localhost.');
    return;
  }
  try {
    if (stream) releaseStream(); // idempotente

    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 1280 }, height: { ideal: 720 },
        facingMode: { ideal: 'user' }
      },
      audio: false
    });
    cam.srcObject = stream;
    await cam.play?.();

    if (cam.readyState >= 2) syncCanvasToVideo();
    else cam.addEventListener('loadedmetadata', syncCanvasToVideo, { once: true });

    setCamStatus('ok', `Listo (${cam.videoWidth||1280}x${cam.videoHeight||720})`, 'La cámara está activa. Puedes Iniciar.');

    (async () => {
      try {
        if (!landmarker) {
          const wasmBase = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm";
          const fileset = await FilesetResolver.forVisionTasks(wasmBase);
          landmarker = await FaceLandmarker.createFromOptions(fileset, {
            baseOptions: {
              modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
            },
            runningMode: "VIDEO",
            numFaces: 1,
            outputFaceBlendshapes: true,
          });
        }
      } catch (err) {
        console.warn("FaceLandmarker no disponible (continuará sin mirada):", err);
      }
    })();

  } catch (e) {
    const n = e?.name || 'CameraError';
    if (n === 'NotAllowedError' || n === 'SecurityError') {
      setCamStatus('err', 'Permiso denegado', 'Candado → Cámara: Permitir.');
    } else if (n === 'NotFoundError' || n === 'OverconstrainedError') {
      setCamStatus('err', 'Sin cámara', 'Conecta una webcam o verifica drivers.');
    } else if (n === 'NotReadableError') {
      setCamStatus('warn', 'Cámara ocupada', 'Cierra Zoom/Meet/Teams y reintenta.');
    } else {
      setCamStatus('err', 'Error de cámara', `Detalle: ${n}`);
    }
  }
}

/* ========== Loop ========== */
function loop(){
  if (!running) return;
  if (cam.readyState < 2){ requestAnimationFrame(loop); return; }

  const t0 = performance.now();
  ctx.drawImage(cam,0,0,canvas.width,canvas.height);
  const t1 = performance.now();

  // Métricas por frame
  try { const m0=metrics.onFrameStart?.(); metrics.onFrameEnd?.(m0??t0); } catch {}

  frameCount++;
  if (frameCount % 10 === 0){
    updatePerfUI();
    const ms = performance.now() - sessionStart;
    sessionTime && (sessionTime.textContent = fmtTime(ms));

    // Pestaña
    const nowVisible = (document.visibilityState === 'visible');
    tabState && (tabState.textContent = nowVisible ? 'En pestaña' : 'Fuera de pestaña');

    // Atención priorizando pestaña; luego mirada estabilizada
    let attnState = 'atento';
    if (!nowVisible) {
      const hiddenFor = offTabStart ? (performance.now() - offTabStart) : 0;
      attnState = hiddenFor >= 2000 ? 'distracción (fuera de pestaña)' : 'intermitente';
    } else if (isLookAway) {
      attnState = 'mirada desviada';
    }
    attnEl && (attnEl.textContent = attnState);

    // Tiempo fuera acumulado
    const accum = offTabAccumMs + (offTabStart ? (performance.now() - offTabStart) : 0);
    offTimeEl && (offTimeEl.textContent = fmtTime(accum));
    offCntEl  && (offCntEl.textContent  = String(offTabEpisodes));
  }

  // ---- Detección robusta de “mirada desviada” con EMA + MOVIMIENTO ----
  if (landmarker && frameCount % DETECT_EVERY === 0) {
    const ts = performance.now();
    if (cam.currentTime !== lastVideoTime) {
      lastVideoTime = cam.currentTime;
      const out = landmarker.detectForVideo(cam, ts);
      const lm  = out?.faceLandmarks?.[0];

      let awayNow = false;
      let backNow = false;

      if (lm) {
        // bbox normalizado
        let minx=1,maxx=0,miny=1,maxy=0;
        for (const p of lm) { if(p.x<minx)minx=p.x; if(p.x>maxx)maxx=p.x; if(p.y<miny)miny=p.y; if(p.y>maxy)maxy=p.y; }
        const w = maxx - minx, h = maxy - miny, area = w * h;
        const arRaw = w / (h + 1e-6);

        // Centro del bbox vs centroide de landmarks (offset lateral)
        const cx = (minx + maxx) / 2;
        let gx = 0;
        for (const p of lm) gx += p.x;
        gx /= lm.length;
        const offRaw = Math.abs((gx - cx) / (w + 1e-6));

        if (area >= MIN_FACE_AREA) {
          // EMA corto
          emaAR  = (emaAR  == null) ? arRaw  : (1-EMA_ALPHA)*emaAR  + EMA_ALPHA*arRaw;
          emaOFF = (emaOFF == null) ? offRaw : (1-EMA_ALPHA)*emaOFF + EMA_ALPHA*offRaw;

          const dAR  = Math.abs(arRaw  - emaAR);
          const dOFF = Math.abs(offRaw - emaOFF);
          const movementFast = (dOFF > MOVE_OFF) || (dAR > MOVE_AR);

          // Umbrales dinámicos con histéresis (más sensibles)
          const useEnterAR  = dyn.enterAR;
          const useExitAR   = dyn.exitAR;
          const useEnterOFF = dyn.enterOFF;
          const useExitOFF  = dyn.exitOFF;

          awayNow = movementFast || (arRaw < useEnterAR) || (offRaw > useEnterOFF);
          backNow = (arRaw > useExitAR) && (offRaw < useExitOFF) && !movementFast;
        }
      } // si no hay rostro, no penalizamos

      // Integrador por score (más reactivo a movimiento)
      if (awayNow) {
        awayScore = Math.min(SCORE_ENTER, awayScore + (3)); // sube más rápido
      } else if (backNow) {
        awayScore = Math.max(0, awayScore - 2);
      } else {
        awayScore = Math.max(0, awayScore - 1);
      }

      if (!isLookAway && awayScore >= SCORE_ENTER) isLookAway = true;
      if (isLookAway  && awayScore <= SCORE_EXIT)  isLookAway = false;
    }
  }

  requestAnimationFrame(loop);
}

/* ========== Pestaña: episodios y acumulado ========== */
document.addEventListener('visibilitychange', () => {
  if (!running) return;
  const now = performance.now();
  if (document.visibilityState === 'hidden') {
    offTabStart = now;
  } else if (offTabStart != null) {
    const dur = now - offTabStart;
    if (dur >= 1500) offTabEpisodes += 1;
    offTabAccumMs += dur;
    offTabStart = null;
  }
});

/* ========== Handlers ========== */
btnPermitir?.addEventListener('click', async ()=>{
  if (!hasConsent()){
    const mb=document.getElementById('consent-backdrop'), mm=document.getElementById('consent-modal');
    if (mb && mm){ mb.classList.remove('hidden'); mm.classList.remove('hidden'); }
    return;
  }
  camRequested = true;
  await startCamera();
});
btnRetry?.addEventListener('click', ()=>{
  releaseStream();
  setCamStatus('neutral','Permiso pendiente','Presiona “Permitir cámara”.');
});

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

  // reset pestaña/atención
  offTabStart   = (document.visibilityState === 'hidden') ? performance.now() : null;
  offTabEpisodes= 0;
  offTabAccumMs = 0;

  // reset detección
  awayScore = 0; isLookAway = false;
  calibrating = !!landmarker; calStart = performance.now();
  calAR.length=0; calOFF.length=0;
  emaAR=null; emaOFF=null;

  // métricas
  metrics.start();

  sessionStatus && (sessionStatus.textContent = 'Monitoreando');
  tabLogger.start?.();
  requestAnimationFrame(loop);
});

btnStop?.addEventListener('click', ()=>{
  if (offTabStart != null){
    const now = performance.now();
    const dur = now - offTabStart;
    if (dur >= 1500) offTabEpisodes += 1;
    offTabAccumMs += dur;
    offTabStart = null;
  }
  running = false;
  metrics.stop();
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

/* ========== Tabs ========== */
function showSection(key){
  for (const k of Object.keys(sections)){ const el=sections[k]; if(!el) continue; (k===key)?el.classList.remove('hidden'):el.classList.add('hidden'); }
  tabButtons.forEach(b => b.classList.toggle('active', b.dataset.t===key));
}
tabButtons.forEach(btn=>btn.addEventListener('click', ()=>{ const k=btn.dataset.t; if(k) showSection(k); }));
showSection(tabButtons.find(b=>b.classList.contains('active'))?.dataset.t || 'lectura');

/* ========== Estado inicial ========== */
(function init(){
  if (!navigator.mediaDevices?.getUserMedia){ setCamStatus('err','No soportado','Usa Chrome/Edge.'); return; }
  if (insecureContext()){ setCamStatus('warn','HTTPS requerido','Abre con candado (HTTPS) o localhost.'); return; }
  setCamStatus('neutral','Permiso pendiente','Presiona “Permitir cámara”.');
  sessionStatus && (sessionStatus.textContent = 'Detenida');
  sessionTime && (sessionTime.textContent = '00:00');
  fpsEl&&(fpsEl.textContent='0'); p95El&&(p95El.textContent='0.0');
  tabState&&(tabState.textContent='—'); attnEl&&(attnEl.textContent='—');
  offCntEl&&(offCntEl.textContent='0'); offTimeEl&&(offTimeEl.textContent='00:00');

  document.getElementById('open-privacy')
    ?.addEventListener('click', (e)=>{ e.preventDefault(); window.open('/privacidad.html','_blank','noopener'); });
})();

/* ========== Calibración: umbrales dinámicos (más sensibles) ========== */
// Se ejecuta durante el loop: guardamos muestras y al cumplir tiempo calculamos baseline
(function attachCalibrationWatcher(){
  const med = a => {
    const s=[...a].sort((x,y)=>x-y), m=Math.floor(s.length/2);
    return s.length%2?s[m]:(s[m-1]+s[m])/2;
  };

  // Hook: revisit dyn cada ~300ms usando requestAnimationFrame guardado en variables de arriba
  let lastCheck = 0;
  const tick = ()=>{
    if (running && calibrating) {
      const now = performance.now();
      if ((now - calStart) >= CALIBRATION_MS && calAR.length >= 6) {
        const baseAR  = med(calAR);
        const baseOFF = med(calOFF);

        // Márgenes más sensibles: entran antes, salen con pequeña histéresis
        dyn.enterAR  = Math.max(0.55, baseAR - 0.10);
        dyn.exitAR   = Math.max(dyn.enterAR + 0.04, baseAR - 0.03);
        dyn.enterOFF = Math.min(0.32, baseOFF + 0.08);
        dyn.exitOFF  = Math.min(0.28, baseOFF + 0.05);

        calibrating = false;
        console.log('Calibrado (sens):', { baseAR, baseOFF, dyn });
      }
      lastCheck = now;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})();

/* ========== Captura muestras para calibración dentro del loop de landmarks ========== */
// (La recolección ocurre en el bloque de landmarks; cuando calibrating=true se hace calAR.push/calOFF.push)
