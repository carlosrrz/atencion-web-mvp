// app.js — Atención con YAW real (matriz) + fallback por profundidad Z, calibración y adaptación
import { createMetrics } from './metrics.js';
import { createTabLogger } from './tab-logger.js';
import { FilesetResolver, FaceLandmarker } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3";

/* ===== DOM ===== */
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

/* ===== Parámetros ===== */
const DETECT_EVERY   = 2;
const MIN_FACE_AREA  = 0.06;
const CALIBRATION_MS = 1200;

const EMA_ALPHA = 0.30;
const MOVE_OFF  = 0.085;
const MOVE_AR   = 0.060;
const MOVE_YAW  = 0.12;  // ~7° si usamos rad

const SCORE_ENTER = 6;
const SCORE_EXIT  = 2;

/* ===== Estado ===== */
let awayScore   = 0;
let isLookAway  = false;

let stream = null;
let running = false;
let camRequested = false;
let frameCount = 0;
let sessionStart = 0;

let landmarker = null;
let lastVideoTime = -1;

let offTabStart = null;
let offTabEpisodes = 0;
let offTabAccumMs = 0;

const metrics = createMetrics();
const tabLogger = createTabLogger();

/* Calibración / baseline */
let calibrating = false;
let calStart = 0;
let calAR = [], calOFF = [], calYAW = [];

// baseline y umbrales (se ajustan tras calibrar/adaptar)
let base = { ar: 0.68, off: 0.18, yaw: 0.04 };
let thr  = {
  enter: { ar: 0.58, off: 0.28, yaw: 0.25 },
  exit:  { ar: 0.62, off: 0.24, yaw: 0.16 }
};

let ema = { ar: null, off: null, yaw: null };

/* ===== Util ===== */
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

/* ===== Pose helpers ===== */
// Yaw desde matriz 4x4 (row-major). Usamos |yaw| (rad).
function yawFromMatrix(m){
  const r00 = m[0], r01 = m[1], r02 = m[2];
  const r10 = m[4], r11 = m[5], r12 = m[6];
  const r20 = m[8], r21 = m[9], r22 = m[10];
  // Aproximación estable para yaw (eje Y): atan2(r02, r22)
  return Math.abs(Math.atan2(r02, r22));
}
// Fallback: yaw proxy por diferencia de profundidad Z (izq vs der)
function yawFromZ(lm, cx){
  let zl=0, zr=0, nl=0, nr=0;
  for (const p of lm){
    if (p.x < cx){ zl += p.z; nl++; } else { zr += p.z; nr++; }
  }
  if (!nl || !nr) return 0;
  return Math.abs((zl/nl) - (zr/nr)); // escala relativa; la calibración lo normaliza
}

function adaptBaseline(ar, off, yaw, usingMatrixYaw){
  const ALPHA = 0.02;      // adaptación lenta
  base.ar  = (1-ALPHA)*base.ar  + ALPHA*ar;
  base.off = (1-ALPHA)*base.off + ALPHA*off;
  base.yaw = (1-ALPHA)*base.yaw + ALPHA*yaw;

  // Delta según origen de yaw (matriz en rad vs z-diff)
  const dEnter = usingMatrixYaw ? 0.20 : 0.06;
  const dExit  = usingMatrixYaw ? 0.14 : 0.04;

  thr.enter.ar  = Math.max(0.50, base.ar  - 0.10);
  thr.exit.ar   = Math.max(thr.enter.ar + 0.04, base.ar - 0.03);
  thr.enter.off = Math.min(0.40, base.off + 0.10);
  thr.exit.off  = Math.min(0.34, base.off + 0.06);
  thr.enter.yaw = base.yaw + dEnter;
  thr.exit.yaw  = base.yaw + dExit;
}

/* ===== Cámara ===== */
async function startCamera() {
  if (insecureContext()) {
    setCamStatus('warn', 'HTTPS requerido', 'Abre la app en HTTPS o localhost.');
    return;
  }
  try {
    if (stream) releaseStream();

    stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: { ideal: 'user' } },
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
            baseOptions: { modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task" },
            runningMode: "VIDEO",
            numFaces: 1,
            outputFaceBlendshapes: true,
            // 👇 IMPORTANTE: habilita matriz de transformación para obtener yaw real
            outputFacialTransformationMatrixes: true
          });
        }
      } catch (err) { console.warn("FaceLandmarker no disponible:", err); }
    })();

  } catch (e) {
    const n = e?.name || 'CameraError';
    if (n === 'NotAllowedError' || n === 'SecurityError') setCamStatus('err','Permiso denegado','Candado → Cámara: Permitir.');
    else if (n === 'NotFoundError' || n === 'OverconstrainedError') setCamStatus('err','Sin cámara','Conecta una webcam o verifica drivers.');
    else if (n === 'NotReadableError') setCamStatus('warn','Cámara ocupada','Cierra Zoom/Meet/Teams y reintenta.');
    else setCamStatus('err','Error de cámara',`Detalle: ${n}`);
  }
}

/* ===== Loop ===== */
function loop(){
  if (!running) return;
  if (cam.readyState < 2){ requestAnimationFrame(loop); return; }

  const t0 = performance.now();
  ctx.drawImage(cam,0,0,canvas.width,canvas.height);
  const t1 = performance.now();

  try { const m0=metrics.onFrameStart?.(); metrics.onFrameEnd?.(m0??t0); } catch {}

  frameCount++;
  if (frameCount % 10 === 0){
    updatePerfUI();
    const ms = performance.now() - sessionStart;
    sessionTime && (sessionTime.textContent = fmtTime(ms));

    const nowVisible = (document.visibilityState === 'visible');
    tabState && (tabState.textContent = nowVisible ? 'En pestaña' : 'Fuera de pestaña');

    let attnState = 'atento';
    if (!nowVisible) {
      const hiddenFor = offTabStart ? (performance.now() - offTabStart) : 0;
      attnState = hiddenFor >= 2000 ? 'distracción (fuera de pestaña)' : 'intermitente';
    } else if (isLookAway) attnState = 'mirada desviada';
    attnEl && (attnEl.textContent = attnState);
    const accum = offTabAccumMs + (offTabStart ? (performance.now() - offTabStart) : 0);
    offTimeEl && (offTimeEl.textContent = fmtTime(accum));
    offCntEl  && (offCntEl.textContent  = String(offTabEpisodes));
  }

  // ---- Detección: YAW (matriz o Z), offset y AR ----
  if (landmarker && frameCount % DETECT_EVERY === 0) {
    const ts = performance.now();
    if (cam.currentTime !== lastVideoTime) {
      lastVideoTime = cam.currentTime;
      const out = landmarker.detectForVideo(cam, ts);
      const lm  = out?.faceLandmarks?.[0];

      let awayNow = false, backNow = false;

      if (lm) {
        // bbox
        let minx=1,maxx=0,miny=1,maxy=0;
        for (const p of lm) { if(p.x<minx)minx=p.x; if(p.x>maxx)maxx=p.x; if(p.y<miny)miny=p.y; if(p.y>maxy)maxy=p.y; }
        const w = maxx - minx, h = maxy - miny, area = w * h;
        if (area >= MIN_FACE_AREA) {
          const arRaw  = w / (h + 1e-6);
          const cx     = (minx + maxx) / 2;
          let gx = 0; for (const p of lm) gx += p.x; gx /= lm.length;
          const offRaw = Math.abs((gx - cx) / (w + 1e-6));

          // YAW real si hay matriz; si no, fallback por z
          let usingMatrixYaw = false;
          let yawAbs = 0;
          const M = out?.facialTransformationMatrixes?.[0];
          if (M && typeof M[0] === 'number') {
            yawAbs = yawFromMatrix(M);
            usingMatrixYaw = true;
          } else {
            yawAbs = yawFromZ(lm, cx); // diferencia de profundidades
          }

          // EMA
          ema.ar  = (ema.ar  == null) ? arRaw  : (1-EMA_ALPHA)*ema.ar  + EMA_ALPHA*arRaw;
          ema.off = (ema.off == null) ? offRaw : (1-EMA_ALPHA)*ema.off + EMA_ALPHA*offRaw;
          ema.yaw = (ema.yaw == null) ? yawAbs : (1-EMA_ALPHA)*ema.yaw + EMA_ALPHA*yawAbs;

          const dAR  = Math.abs(arRaw  - ema.ar);
          const dOFF = Math.abs(offRaw - ema.off);
          const dYAW = Math.abs(yawAbs - ema.yaw);
          const movementFast = (dOFF > MOVE_OFF) || (dAR > MOVE_AR) || (dYAW > MOVE_YAW);

          // Calibración inicial
          if (calibrating) {
            calAR.push(arRaw); calOFF.push(offRaw); calYAW.push(yawAbs);
            if ((performance.now() - calStart) >= CALIBRATION_MS && calAR.length >= 6) {
              const med = a => { const s=[...a].sort((x,y)=>x-y), m=Math.floor(s.length/2); return s.length%2?s[m]:(s[m-1]+s[m])/2; };
              base.ar  = med(calAR);
              base.off = med(calOFF);
              base.yaw = med(calYAW);
              adaptBaseline(base.ar, base.off, base.yaw, usingMatrixYaw);
              calibrating = false;
              console.log('Calibrado:', { base, thr, usingMatrixYaw });
            }
          }

          // Umbrales vigentes
          const enter = (arRaw < thr.enter.ar) || (offRaw > thr.enter.off) || (yawAbs > thr.enter.yaw);
          const exit  = (arRaw > thr.exit.ar)  && (offRaw < thr.exit.off)  && (yawAbs < thr.exit.yaw);

          awayNow = movementFast || enter;
          backNow = !movementFast && exit;

          // Adaptación lenta cuando “atento”
          if (!isLookAway && !movementFast) {
            adaptBaseline(ema.ar, ema.off, ema.yaw, usingMatrixYaw);
          }
        }
      }

      // Histéresis temporal
      if (awayNow)      awayScore = Math.min(SCORE_ENTER, awayScore + 3);
      else if (backNow) awayScore = Math.max(0, awayScore - 2);
      else              awayScore = Math.max(0, awayScore - 1);

      if (!isLookAway && awayScore >= SCORE_ENTER) isLookAway = true;
      if (isLookAway  && awayScore <= SCORE_EXIT)  isLookAway = false;
    }
  }

  requestAnimationFrame(loop);
}

/* ===== Pestaña ===== */
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

/* ===== Handlers ===== */
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

  offTabStart   = (document.visibilityState === 'hidden') ? performance.now() : null;
  offTabEpisodes= 0;
  offTabAccumMs = 0;

  // reset detección + calibración
  awayScore = 0; isLookAway = false;
  calibrating = !!landmarker; calStart = performance.now();
  calAR.length=0; calOFF.length=0; calYAW.length=0;
  ema = { ar: null, off: null, yaw: null };

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

/* ===== Tabs ===== */
function showSection(key){
  for (const k of Object.keys(sections)){ const el=sections[k]; if(!el) continue; (k===key)?el.classList.remove('hidden'):el.classList.add('hidden'); }
  tabButtons.forEach(b => b.classList.toggle('active', b.dataset.t===key));
}
tabButtons.forEach(btn=>btn.addEventListener('click', ()=>{ const k=btn.dataset.t; if(k) showSection(k); }));
showSection(tabButtons.find(b=>b.classList.contains('active'))?.dataset.t || 'lectura');

/* ===== Init ===== */
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
