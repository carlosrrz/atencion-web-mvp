// app.js — Monitoreo + Evidencias + Resumen + Envío a backend
// ------------------------------------------------------------------
// Dependencias locales (si no existen, el fallback sigue funcionando)
import { createMetrics }     from './metrics.js';
import { createTabLogger }   from './tab-logger.js';

// Opcional: sobreescribir saveAttempt/updateLastAttemptExam si existe store.js
let saveAttempt = (attempt) => {
  try {
    const KEY = 'proctor.attempts.v1';
    const arr = JSON.parse(localStorage.getItem(KEY) || '[]');
    arr.push(attempt);
    localStorage.setItem(KEY, JSON.stringify(arr));
  } catch (e) { console.warn('[app] fallback saveAttempt error:', e); }
};
let updateLastAttemptExam; // opcional

(async () => {
  try {
    const mod =
      (await import('./store.js').catch(() => null)) ||
      (await import('../store.js').catch(() => null)) ||
      (await import('../src/store.js').catch(() => null));
    if (mod?.saveAttempt) saveAttempt = mod.saveAttempt;
    if (mod?.updateLastAttemptExam) updateLastAttemptExam = mod.updateLastAttemptExam;
    console.log('[app] store.js activo');
  } catch {
    console.warn('[app] store.js no encontrado; usando fallback local');
  }
})();

// ------------------------------------------------------------------
// MediaPipe
import {
  FilesetResolver,
  FaceLandmarker
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3";

// ------------------------------------------------------------------
// Inputs del estudiante
const studentName  = document.getElementById('student-name');
const studentCode  = document.getElementById('student-code');
const studentEmail = document.getElementById('student-email');

// ------------------------------------------------------------------
// DOM principal
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
const lipsEl    = document.getElementById('lips-state');
const offCntEl  = document.getElementById('offtab-count');
const offTimeEl = document.getElementById('offtab-time');

const fpsEl   = document.getElementById('fps');
const p95El   = document.getElementById('p95');
const fpsPill = document.getElementById('fps-pill');
const p95Pill = document.getElementById('p95-pill');
const perfAll = document.getElementById('perf-overall');

// Modal de resumen
const summaryBackdrop = document.getElementById('summary-backdrop');
const summaryModal    = document.getElementById('summary-modal');
const summaryBody     = document.getElementById('summary-body');
const btnSumJSON      = document.getElementById('summary-download-json');
const btnSumCSV       = document.getElementById('summary-download-csv');
const btnSumClose     = document.getElementById('summary-close');

// Modal de evidencias (si lo usas en UI del alumno)
const evBackdrop   = document.getElementById('evidence-backdrop');
const evModal      = document.getElementById('evidence-modal');
const evGrid       = document.getElementById('evidence-grid');
const btnEvid      = document.getElementById('btn-evidencias');
const btnEvidClose = document.getElementById('btn-evid-close');
const btnEvidDl    = document.getElementById('btn-evid-download');

// ------------------------------------------------------------------
// Evidencias
function createEvidence(){
  const items = []; // {t, kind, note, data}
  function snap(kind, note){
    try{
      if (!cam?.videoWidth) return; // cámara no lista
      const off = document.createElement('canvas');
      off.width = 320; off.height = Math.round(320*(cam.videoHeight/cam.videoWidth));
      off.getContext('2d').drawImage(cam,0,0,off.width,off.height);
      items.push({ t: Date.now(), kind, note, data: off.toDataURL('image/jpeg',0.9) });
      if (items.length > 80) items.shift();
    }catch(e){ console.warn('[evidence] snap fail', e); }
  }
  return {
    snap,
    list:  () => items.slice(),
    clear: () => { items.length=0; },
    downloadJSON(){
      const blob = new Blob([JSON.stringify(items,null,2)],{type:'application/json'});
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'evidencias.json'; a.click();
      URL.revokeObjectURL(a.href);
    }
  };
}
const evidence = createEvidence();

// ------------------------------------------------------------------
// Parámetros
const DETECT_EVERY   = 2;
const MIN_FACE_AREA  = 0.045;
const OCCL_AREA_MIN  = 0.018;
const OCCL_ENTER_MS  = 700;
const OCCL_EXIT_MS   = 400;

const CALIBRATION_MS = 1200;

const EMA_ALPHA = 0.30;
const MOVE_OFF   = 0.085;
const MOVE_AR    = 0.060;
const MOVE_YAW   = 0.12;
const MOVE_PITCH = 0.12;
const MOVE_EYE   = 0.10;

// Histeresis mirada
const SCORE_ENTER = 6;
const SCORE_EXIT  = 2;

// Labios
const LIPS_SCORE_ENTER = 6;
const LIPS_SCORE_EXIT  = 2;
const LIPS_VEL_ALPHA = 0.5;
const LIPS_VEL_ENTER = 0.040;
const LIPS_VEL_EXIT  = 0.026;
const LIPS_WIN_MS    = 900;
const LIPS_OSC_MIN   = 2;
const LIPS_MIN_AMP   = 0.060;

// Blink
const BLINK_ENTER = 0.55;
const BLINK_EXIT  = 0.35;
const BLINK_MAX_MS = 280;

// ------------------------------------------------------------------
// Estado
let awayScore   = 0, isLookAway = false;
let lipsScore   = 0, lipsActive = false;

let isOccluded       = false;
let occlSince        = null;
let occlClearSince   = null;

let blinkActive = false;
let blinkSince  = null;

let stream = null;
let running = false;
let camRequested = false;
let frameCount = 0;
let sessionStart = 0;
let startedAtISO = null;

let landmarker = null;

// Off-tab
let offTabStart = null;
let offTabEpisodes = 0;
let offTabAccumMs = 0;

// Métricas y logger
const metrics   = createMetrics();
const tabLogger = createTabLogger({ offTabThresholdMs: 1500 });

// Calibración
let calibrating = false;
let calStart = 0;
let ema = { ar:null, off:null, yaw:null, pitch:null, gaze:null, gH:null, gV:null, mouth:null };
let base = { ar: 0.68, off: 0.18, yaw: 0.04, pitch: 0.04, gaze: 0.05, gH: 0.00, gV: 0.00, mouth: 0.02 };
let thr  = {
  enter:{ ar:0.58, off:0.28, yaw:0.24, pitch:0.12, gaze:0.35, gH:0.28, gV:0.28, mouth:0.28 },
  exit: { ar:0.62, off:0.24, yaw:0.16, pitch:0.09, gaze:0.25, gH:0.20, gV:0.20, mouth:0.18 }
};
let invertSense = false;

// Labios
let lipsPrev = null;
let lipsVelEMA = 0;
let mouthHist = [];

// Episodios
let lookAwayStart = null, lookAwayEpisodes = 0, lookAwayAccumMs = 0, lookAwayLongestMs = 0;
let lipsStart     = null, lipsEpisodes     = 0, lipsAccumMs     = 0, lipsLongestMs     = 0;
let occlEpStart   = null, occlEpisodes     = 0, occlAccumMs     = 0, occlLongestMs     = 0;

// Examen
let lastExamResult = null;

// ------------------------------------------------------------------
// Utils
const insecureContext = () => !(location.protocol === 'https:' || location.hostname === 'localhost');
const clamp01 = v => Math.max(0, Math.min(1, v));
const isInTab = () => (document.visibilityState === 'visible') && document.hasFocus();

function setCamStatus(kind, msg, help=''){
  if(!camStatus) return;
  camStatus.className = 'pill ' + (kind==='ok'?'pill-ok':kind==='warn'?'pill-warn':kind==='err'?'pill-err':'pill-neutral');
  camStatus.textContent = msg;
  if (camHelp){
    if (help){ camHelp.textContent = help; camHelp.classList.remove('hidden'); }
    else camHelp.classList.add('hidden');
  }
}
function releaseStream(){ try { stream?.getTracks()?.forEach(t=>t.stop()); } catch{} stream=null; window.__camReady = false; }
function syncCanvasToVideo(){ const w=cam.videoWidth||640, h=cam.videoHeight||360; canvas.width=w; canvas.height=h; }
const fmtTime = (ms)=>{ const s=Math.floor((ms||0)/1000); const mm=String(Math.floor(s/60)).padStart(2,'0'); const ss=String(s%60).padStart(2,'0'); return `${mm}:${ss}`; };

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

// ------------------------------------------------------------------
// Pose / Gaze helpers (algunas aproximaciones)
function yawFromEyes(lm){
  const L = lm?.[33], R = lm?.[263];
  if (!L || !R) return 0;
  const dz = (R.z - L.z), dx = (R.x - L.x) + 1e-6;
  return Math.abs(Math.atan2(dz, dx));
}
function pitchFromFeatures(lm){
  const L = lm?.[33], R = lm?.[263], nose = lm?.[1] || lm?.[4] || lm?.[0];
  if (!L || !R || !nose) return 0;
  const eyeMidY = (L.y + R.y) / 2;
  const eyeDist = Math.hypot(R.x - L.x, R.y - L.y) + 1e-6;
  const dy = (nose.y - eyeMidY);
  return Math.abs(Math.atan2(dy, eyeDist));
}
function lateralOffset(lm, minx, maxx){
  const w = maxx - minx + 1e-6;
  const cx = (minx + maxx) / 2;
  let gx = 0; for (const p of lm) gx += p.x; gx /= lm.length;
  return Math.abs((gx - cx) / w);
}
function fracOutOfBounds(lm){
  let oob = 0;
  for (const p of lm){ if (p.x<0 || p.x>1 || p.y<0 || p.y>1) oob++; }
  return lm?.length ? (oob / lm.length) : 1;
}
function pickBS(bs, name){ return bs?.categories?.find(c => c.categoryName === name)?.score ?? 0; }
function blinkScore(bs){ return Math.max(pickBS(bs,'eyeBlinkLeft'), pickBS(bs,'eyeBlinkRight')); }
function updateBlink(bs, ts){
  const s = blinkScore(bs);
  if (!blinkActive && s >= BLINK_ENTER){ blinkActive = true; blinkSince = ts; }
  else if (blinkActive){
    const dur = ts - (blinkSince ?? ts);
    if ((s <= BLINK_EXIT) || (dur > BLINK_MAX_MS)){ blinkActive = false; blinkSince = null; }
  }
}
function gazeMagnitude(bs){
  if (!bs?.categories?.length) return 0;
  const pick = (name) => bs.categories.find(c => c.categoryName === name)?.score ?? 0;
  const parts = ['eyeLookUpLeft','eyeLookUpRight','eyeLookDownLeft','eyeLookDownRight','eyeLookInLeft','eyeLookInRight','eyeLookOutLeft','eyeLookOutRight'];
  const s = parts.reduce((a,n)=>a + pick(n), 0);
  return Math.min(1, s / parts.length);
}
function gazeHV(bs){
  const pick = (name) => bs?.categories?.find(c => c.categoryName === name)?.score ?? 0;
  const inL  = pick('eyeLookInLeft'),   outL = pick('eyeLookOutLeft');
  const inR  = pick('eyeLookInRight'),  outR = pick('eyeLookOutRight');
  const upL  = pick('eyeLookUpLeft'),   upR  = pick('eyeLookUpRight');
  const dnL  = pick('eyeLookDownLeft'), dnR  = pick('eyeLookDownRight');
  const hRight = outL + inR, hLeft = inL + outR;
  const h = (hRight - hLeft) / 2, hAbs = Math.abs(h);
  const vUp = upL + upR, vDown = dnL + dnR;
  const v = (vUp - vDown) / 2, vAbs = Math.abs(v);
  return { hAbs, vAbs };
}
function lipsComponents(bs){
  const jaw    = pickBS(bs,'jawOpen');
  const upper  = (pickBS(bs,'mouthUpperUpLeft') + pickBS(bs,'mouthUpperUpRight'))/2;
  const lower  = (pickBS(bs,'mouthLowerDownLeft') + pickBS(bs,'mouthLowerDownRight'))/2;
  const stretch= (pickBS(bs,'mouthStretchLeft') + pickBS(bs,'mouthStretchRight'))/2;
  const funnel = pickBS(bs,'mouthFunnel');
  const pucker = pickBS(bs,'mouthPucker');
  const smile  = (pickBS(bs,'mouthSmileLeft') + pickBS(bs,'mouthSmileRight'))/2;
  return { jaw, upper, lower, stretch, funnel, pucker, smile };
}
function mouthOpenScore(comp){
  if (!comp) return 0;
  const raw = 0.50*comp.jaw + 0.22*((comp.upper + comp.lower)/2) + 0.18*comp.stretch + 0.10*((comp.funnel + comp.pucker)/2) - 0.10*comp.smile;
  return clamp01(raw);
}
function updateLipsVelocity(comp){
  if (!comp) return;
  if (!lipsPrev) { lipsPrev = comp; lipsVelEMA = 0; return; }
  const dif =
    Math.abs(comp.jaw - lipsPrev.jaw) * 0.45 +
    Math.abs(comp.upper - lipsPrev.upper) * 0.18 +
    Math.abs(comp.lower - lipsPrev.lower) * 0.18 +
    Math.abs(comp.stretch - lipsPrev.stretch) * 0.12 +
    Math.abs(comp.funnel - lipsPrev.funnel) * 0.04 +
    Math.abs(comp.pucker - lipsPrev.pucker) * 0.03;
  lipsVelEMA = (1 - LIPS_VEL_ALPHA) * lipsVelEMA + LIPS_VEL_ALPHA * dif;
  lipsPrev = comp;
}
function pushMouthHist(t, v){
  mouthHist.push({t, v});
  const cutoff = t - LIPS_WIN_MS;
  while (mouthHist.length && mouthHist[0].t < cutoff) mouthHist.shift();
}
function lipsOscillationFeatures(){
  if (mouthHist.length < 4) return {amp:0, osc:0};
  const vals = mouthHist.map(x=>x.v);
  const amp = Math.max(...vals) - Math.min(...vals);
  let osc = 0, prevDiff = null;
  for (let i=1;i<vals.length;i++){
    const diff = vals[i] - vals[i-1];
    if (prevDiff != null && Math.sign(diff) !== Math.sign(prevDiff)) osc++;
    prevDiff = diff;
  }
  return { amp, osc };
}
function adaptBaseline(ar, off, yaw, pitch, gaze, gH, gV, mouth){
  const ALPHA = 0.02;
  base.ar    = (1-ALPHA)*base.ar    + ALPHA*ar;
  base.off   = (1-ALPHA)*base.off   + ALPHA*off;
  base.yaw   = (1-ALPHA)*base.yaw   + ALPHA*yaw;
  base.pitch = (1-ALPHA)*base.pitch + ALPHA*pitch;
  base.gaze  = (1-ALPHA)*base.gaze  + ALPHA*gaze;
  base.gH    = (1-ALPHA)*base.gH    + ALPHA*gH;
  base.gV    = (1-ALPHA)*base.gV    + ALPHA*gV;
  base.mouth = (1-ALPHA)*base.mouth + ALPHA*mouth;

  thr.enter.ar    = Math.max(0.50, base.ar  - 0.10);
  thr.exit.ar     = Math.max(thr.enter.ar + 0.04, base.ar - 0.03);
  thr.enter.off   = Math.min(0.40, base.off + 0.10);
  thr.exit.off    = Math.min(0.34, base.off + 0.06);
  thr.enter.yaw   = base.yaw   + 0.20;
  thr.exit.yaw    = base.yaw   + 0.14;
  thr.enter.pitch = base.pitch + 0.12;
  thr.exit.pitch  = base.pitch + 0.09;
  thr.enter.gH    = Math.max(0.22, base.gH + 0.18);
  thr.exit.gH     = Math.max(0.16, base.gH + 0.12);
  thr.enter.gV    = Math.max(0.22, base.gV + 0.18);
  thr.exit.gV     = Math.max(0.16, base.gV + 0.12);
  thr.enter.gaze  = base.gaze + 0.20;
  thr.exit.gaze   = base.gaze + 0.12;

  thr.enter.mouth = Math.max(0.20, base.mouth + 0.14);
  thr.exit.mouth  = Math.max(0.12, base.mouth + 0.08);
}

// ------------------------------------------------------------------
// Cámara + modelo
async function startCamera() {
  if (insecureContext()) { setCamStatus('warn','HTTPS requerido','Abre la app en HTTPS o localhost.'); return; }
  try {
    if (stream) releaseStream();

    stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: { ideal: 'user' } },
      audio: false
    });
    cam.srcObject = stream;
    await cam.play?.();
    window.__camReady = true;

    if (cam.readyState >= 2) syncCanvasToVideo();
    else cam.addEventListener('loadedmetadata', syncCanvasToVideo, { once: true });

    setCamStatus('ok', `Listo (${cam.videoWidth||1280}x${cam.videoHeight||720})`, 'La cámara está activa. Puedes Iniciar.');

    // Modelo
    (async () => {
      try {
        if (!landmarker) {
          const wasmBase = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm";
          const fileset = await FilesetResolver.forVisionTasks(wasmBase);
          landmarker = await FaceLandmarker.createFromOptions(fileset, {
            baseOptions: {
              modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task"
            },
            runningMode: "VIDEO",
            numFaces: 1,
            outputFaceBlendshapes: true,
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

// ------------------------------------------------------------------
// UI episodios en vivo (si tus spans existen)
let lookCntEl = document.getElementById('lookaway-count');
let lookTimeEl= document.getElementById('lookaway-time');
let occlCntEl = document.getElementById('occl-count');
let occlTimeEl= document.getElementById('occl-time');
let lipsCntEl = document.getElementById('lips-count');
let lipsTimeEl= document.getElementById('lips-time');

function updateLiveEpisodeUI(nowTs){
  if (!nowTs) nowTs = performance.now();
  const lookMs = lookAwayAccumMs + (lookAwayStart ? (nowTs - lookAwayStart) : 0);
  const occlMs = occlAccumMs     + (occlEpStart   ? (nowTs - occlEpStart)   : 0);
  const lipsMs = lipsAccumMs     + (lipsStart     ? (nowTs - lipsStart)     : 0);

  lookCntEl  && (lookCntEl.textContent  = String(lookAwayEpisodes));
  lookTimeEl && (lookTimeEl.textContent = fmtTime(lookMs));
  occlCntEl  && (occlCntEl.textContent  = String(occlEpisodes));
  occlTimeEl && (occlTimeEl.textContent = fmtTime(occlMs));
  lipsCntEl  && (lipsCntEl.textContent  = String(lipsEpisodes));
  lipsTimeEl && (lipsTimeEl.textContent = fmtTime(lipsMs));
}

// ------------------------------------------------------------------
// Loop principal
function loop(){
  if (!running) return;
  if (cam.readyState < 2){ requestAnimationFrame(loop); return; }

  // Dibujar frame (para tener referencia de la cámara en canvas si lo usas)
  try{ ctx.drawImage(cam,0,0,canvas.width,canvas.height); }catch{}

  // Métricas
  try { const m0=metrics.onFrameStart?.(); metrics.onFrameEnd?.(m0??performance.now()); } catch {}

  frameCount++;
  if (frameCount % 10 === 0){
    updatePerfUI();

    const now = performance.now();
    const ms = now - sessionStart;
    sessionTime && (sessionTime.textContent = fmtTime(ms));

    const inTab = isInTab();
    tabState && (tabState.textContent = inTab ? 'En pestaña' : 'Fuera de pestaña');

    let attnState = 'atento';
    if (!inTab) {
      const hiddenFor = offTabStart ? (now - offTabStart) : 0;
      attnState = hiddenFor >= 2000 ? 'distracción (fuera de pestaña)' : 'intermitente';
    } else if (isOccluded) {
      attnState = 'posible desconcentración (rostro cubierto/fuera)';
    } else if (isLookAway) {
      attnState = 'mirada desviada';
    }
    attnEl && (attnEl.textContent = attnState);
    lipsEl && (lipsEl.textContent = lipsActive ? 'movimiento (posible habla)' : '—');

    const accum = offTabAccumMs + (offTabStart ? (now - offTabStart) : 0);
    offTimeEl && (offTimeEl.textContent = fmtTime(accum));
    offCntEl  && (offCntEl.textContent  = String(offTabEpisodes));

    updateLiveEpisodeUI(now);
  }

  // Detección
  if (landmarker && frameCount % DETECT_EVERY === 0) {
    const ts = performance.now();
    let prevLook = isLookAway, prevLips = lipsActive, prevOcc = isOccluded;

    try {
      const out = landmarker.detectForVideo(cam, ts);
      const lm  = out?.faceLandmarks?.[0];
      const bs  = out?.faceBlendshapes?.[0];

      if (bs) updateBlink(bs, ts);

      // Sin cara / oclusión
      if (!lm) {
        occlClearSince = null;
        if (!occlSince) occlSince = ts;
        if (!isOccluded && (ts - occlSince) >= OCCL_ENTER_MS) {
          isOccluded = true;
          awayScore = 0; isLookAway = false;
          lipsScore = 0; lipsActive = false;
          lipsPrev = null; lipsVelEMA = 0;
          blinkActive = false; blinkSince = null;
        }
      }

      let awayNow = false, backNow = false;
      let lipsNow = false, lipsBack = false;

      if (lm) {
        // bbox
        let minx=1,maxx=0,miny=1,maxy=0;
        for (const p of lm) { if(p.x<minx)minx=p.x; if(p.x>maxx)maxx=p.x; if(p.y<miny)miny=p.y; if(p.y>maxy)maxy=p.y; }
        const w = maxx - minx, h = maxy - miny, area = w * h;

        // oclusión por tamaño / puntos fuera
        const oobFrac = fracOutOfBounds(lm);
        const occlNow = (area < OCCL_AREA_MIN) || (oobFrac > 0.35);
        if (occlNow) {
          occlClearSince = null;
          if (!occlSince) occlSince = ts;
          if (!isOccluded && (ts - occlSince) >= OCCL_ENTER_MS) {
            isOccluded = true;
            awayScore = 0; isLookAway = false;
            lipsScore = 0; lipsActive = false;
            lipsPrev = null; lipsVelEMA = 0;
            blinkActive = false; blinkSince = null;
          }
        } else {
          occlSince = null;
          if (!occlClearSince) occlClearSince = ts;
          if (isOccluded && (ts - occlClearSince) >= OCCL_EXIT_MS) {
            isOccluded = false;
          }
        }

        if (area >= MIN_FACE_AREA) {
          const arRaw  = w / (h + 1e-6);
          const offRaw = lateralOffset(lm, minx, maxx);

          // yaw / pitch
          const yawRaw   = yawFromEyes(lm);
          const pitchRaw = pitchFromFeatures(lm);

          // gaze
          const gazeRaw = gazeMagnitude(bs);
          const { hAbs, vAbs } = gazeHV(bs);

          // labios
          const comp     = lipsComponents(bs);
          const mouthRaw = mouthOpenScore(comp);
          updateLipsVelocity(comp);
          pushMouthHist(ts, mouthRaw);
          const { amp: mouthAmp, osc: mouthOsc } = lipsOscillationFeatures();

          // EMA
          ema.ar    = (ema.ar    == null) ? arRaw    : (1-EMA_ALPHA)*ema.ar    + EMA_ALPHA*arRaw;
          ema.off   = (ema.off   == null) ? offRaw   : (1-EMA_ALPHA)*ema.off   + EMA_ALPHA*offRaw;
          ema.yaw   = (ema.yaw   == null) ? yawRaw   : (1-EMA_ALPHA)*ema.yaw   + EMA_ALPHA*yawRaw;
          ema.pitch = (ema.pitch == null) ? pitchRaw : (1-EMA_ALPHA)*ema.pitch + EMA_ALPHA*pitchRaw;
          ema.gaze  = (ema.gaze  == null) ? gazeRaw  : (1-EMA_ALPHA)*ema.gaze  + EMA_ALPHA*gazeRaw;
          ema.gH    = (ema.gH    == null) ? hAbs     : (1-EMA_ALPHA)*ema.gH    + EMA_ALPHA*hAbs;
          ema.gV    = (ema.gV    == null) ? vAbs     : (1-EMA_ALPHA)*ema.gV    + EMA_ALPHA*vAbs;
          ema.mouth = (ema.mouth == null) ? mouthRaw : (1-EMA_ALPHA)*ema.mouth + EMA_ALPHA*mouthRaw;

          const dAR  = Math.abs(arRaw  - ema.ar);
          const dOFF = Math.abs(offRaw - ema.off);
          const dYAW = Math.abs(yawRaw - ema.yaw);
          const dPIT = Math.abs(pitchRaw - ema.pitch);
          const dGH  = Math.abs(hAbs    - ema.gH);
          const dGV  = Math.abs(vAbs    - ema.gV);

          const allowEyeMotion = !blinkActive;
          const movementFast = (dOFF > MOVE_OFF) || (dAR > MOVE_AR) || (dYAW > MOVE_YAW) || (dPIT > MOVE_PITCH) ||
                               (allowEyeMotion && ((dGH > MOVE_EYE) || (dGV > MOVE_EYE)));

          // Calibración (medianas → baseline)
          if (calibrating) {
            (window.__c || (window.__c = {ar:[],off:[],yaw:[],pit:[],gz:[],gH:[],gV:[],mo:[]})); // dbg opcional
            __c.ar.push(arRaw); __c.off.push(offRaw); __c.yaw.push(yawRaw); __c.pit.push(pitchRaw);
            __c.gz.push(gazeRaw); __c.gH.push(hAbs); __c.gV.push(vAbs); __c.mo.push(mouthRaw);
            if ((performance.now() - calStart) >= CALIBRATION_MS && __c.ar.length >= 6) {
              const med = a => { const s=[...a].sort((x,y)=>x-y), m=Math.floor(s.length/2); return s.length%2?s[m]:(s[m-1]+s[m])/2; };
              adaptBaseline(med(__c.ar), med(__c.off), med(__c.yaw), med(__c.pit), med(__c.gz), med(__c.gH), med(__c.gV), med(__c.mo));
              calibrating = false;

              const poseAwayEnter = (base.ar < thr.enter.ar) || (base.yaw > thr.enter.yaw) || (base.pitch > thr.enter.pitch);
              const transAwayEnter= (base.off > thr.enter.off);
              const gazeAwayEnter = (base.gaze > thr.enter.gaze);
              invertSense = !!(poseAwayEnter || transAwayEnter || gazeAwayEnter);
            }
          }

          // Umbrales “mirada desviada”
          const yawAwayEnter   = (yawRaw   > thr.enter.yaw);
          const yawAwayExit    = (yawRaw   < thr.exit.yaw);
          const pitchAwayEnter = (pitchRaw > thr.enter.pitch);
          const pitchAwayExit  = (pitchRaw < thr.exit.pitch);
          const poseAwayEnter  = yawAwayEnter || pitchAwayEnter || (arRaw < thr.enter.ar);
          const poseAwayExit   = yawAwayExit  && pitchAwayExit  && (arRaw > thr.exit.ar);
          const transAwayEnter = (offRaw > thr.enter.off);
          const transAwayExit  = (offRaw < thr.exit.off);

          const eyesAwayEnter  = allowEyeMotion && (ema.gH > thr.enter.gH || ema.gV > thr.enter.gV);
          const eyesAwayExit   = allowEyeMotion ? ((ema.gH < thr.exit.gH) && (ema.gV < thr.exit.gV)) : true;

          const gazeAwayEnter  = allowEyeMotion && (ema.gaze > thr.enter.gaze);
          const gazeAwayExit   = allowEyeMotion ? (ema.gaze < thr.exit.gaze) : true;

          let enter = poseAwayEnter || transAwayEnter || eyesAwayEnter || gazeAwayEnter;
          let exit  = poseAwayExit  && transAwayExit  && eyesAwayExit   && gazeAwayExit;

          if (invertSense) {
            const poseEnter = poseAwayEnter || transAwayEnter;
            const poseExit  = poseAwayExit  && transAwayExit;
            const flippedEnter = poseExit  || eyesAwayEnter || gazeAwayEnter;
            const flippedExit  = poseEnter && eyesAwayExit  && gazeAwayExit;
            enter = flippedEnter;
            exit  = flippedExit;
          }

          // LABIOS
          const lipsActivityHigh = (lipsVelEMA > LIPS_VEL_ENTER);
          const lipsActivityLow  = (lipsVelEMA < LIPS_VEL_EXIT);
          const lipsOscOK        = (mouthOsc >= LIPS_OSC_MIN) && (mouthAmp > LIPS_MIN_AMP);

          lipsNow  = (ema.mouth > thr.enter.mouth) || lipsActivityHigh || lipsOscOK;
          lipsBack = (ema.mouth < thr.exit.mouth) && lipsActivityLow && (mouthAmp < LIPS_MIN_AMP*0.6);

          if (!isOccluded) {
            awayNow = enter || (movementFast && !exit);
            backNow = exit && !movementFast;
            if (!isLookAway && !movementFast) adaptBaseline(ema.ar, ema.off, ema.yaw, ema.pitch, ema.gaze, ema.gH, ema.gV, ema.mouth);
          } else {
            awayNow = false; backNow = true;
            awayScore = 0;  isLookAway = false;
            lipsScore = 0;  lipsActive = false;
            lipsPrev = null; lipsVelEMA = 0;
            blinkActive = false; blinkSince = null;
          }
        }
      }

      // Transiciones: Mirada
      if (!isOccluded) {
        if (awayNow)      awayScore = Math.min(SCORE_ENTER, awayScore + 3);
        else if (backNow) awayScore = Math.max(0, awayScore - 2);
        else              awayScore = Math.max(0, awayScore - 1);

        if (!isLookAway && awayScore >= SCORE_ENTER){
          isLookAway = true;
          evidence.snap('alert/lookAway','Mirada desviada');
        }
        if (isLookAway && awayScore <= SCORE_EXIT){
          isLookAway = false;
        }
      }

      // Transiciones: Labios
      if (!isOccluded) {
        if (lipsNow)       lipsScore = Math.min(LIPS_SCORE_ENTER, lipsScore + 3);
        else if (lipsBack) lipsScore = Math.max(0, lipsScore - 2);
        else               lipsScore = Math.max(0, lipsScore - 1);

        if (!lipsActive && lipsScore >= LIPS_SCORE_ENTER){
          lipsActive = true;
          evidence.snap('alert/speech','Posible habla');
        }
        if (lipsActive && lipsScore <= LIPS_SCORE_EXIT){
          lipsActive = false;
        }
      }

      // Episodios: Mirada
      if (!prevLook && isLookAway) {
        lookAwayStart = ts;
      } else if (prevLook && !isLookAway) {
        if (lookAwayStart != null) {
          const d = ts - lookAwayStart;
          lookAwayAccumMs += d; lookAwayEpisodes += 1; if (d > lookAwayLongestMs) lookAwayLongestMs = d;
          lookAwayStart = null;
        }
      }
      // Episodios: Labios
      if (!prevLips && lipsActive) {
        lipsStart = ts;
      } else if (prevLips && !lipsActive) {
        if (lipsStart != null) {
          const d = ts - lipsStart;
          lipsAccumMs += d; lipsEpisodes += 1; if (d > lipsLongestMs) lipsLongestMs = d;
          lipsStart = null;
        }
      }
      // Episodios: Oclusión
      if (!prevOcc && isOccluded) {
        occlEpStart = ts;
        evidence.snap('alert/occlusion','Rostro cubierto/fuera');
      } else if (prevOcc && !isOccluded) {
        if (occlEpStart != null) {
          const d = ts - occlEpStart;
          occlAccumMs += d; occlEpisodes += 1; if (d > occlLongestMs) occlLongestMs = d;
          occlEpStart = null;
        }
      }

    } catch (err) {
      // no romper el loop si detect falla
    }
  }

  requestAnimationFrame(loop);
}

// ------------------------------------------------------------------
// Off-tab (pestaña / foco)
function handleTabStateChange(){
  if (!running) return;
  const now = performance.now();
  const inTab = isInTab();
  if (!inTab) {
    if (offTabStart == null) offTabStart = now;
  } else if (offTabStart != null) {
    const dur = now - offTabStart;
    if (dur >= 1500) offTabEpisodes += 1;
    offTabAccumMs += dur;
    offTabStart = null;
  }
}
document.addEventListener('visibilitychange', handleTabStateChange);
window.addEventListener('blur', handleTabStateChange);
window.addEventListener('focus', handleTabStateChange);
tabLogger.setOnAlert?.((type)=>{ if (type==='off_tab') evidence.snap('alert/off_tab','Fuera de pestaña ≥ umbral'); });

// ------------------------------------------------------------------
// Botones
btnPermitir?.addEventListener('click', async ()=>{ camRequested = true; await startCamera(); });
btnRetry?.addEventListener('click', ()=>{ releaseStream(); setCamStatus('neutral','Permiso pendiente','Presiona “Permitir cámara”.'); });

// Cerrar episodios al terminar
function closeOpenEpisodes(nowTs){
  if (lookAwayStart != null){ const d=nowTs - lookAwayStart; lookAwayAccumMs += d; lookAwayEpisodes += 1; if (d>lookAwayLongestMs) lookAwayLongestMs=d; lookAwayStart=null; }
  if (lipsStart     != null){ const d=nowTs - lipsStart;     lipsAccumMs     += d; lipsEpisodes     += 1; if (d>lipsLongestMs)     lipsLongestMs=d;     lipsStart=null; }
  if (occlEpStart   != null){ const d=nowTs - occlEpStart;   occlAccumMs     += d; occlEpisodes     += 1; if (d>occlLongestMs)   occlLongestMs=d;   occlEpStart=null; }
  if (offTabStart   != null){ const d=nowTs - offTabStart;   if (d>=1500) offTabEpisodes += 1; offTabAccumMs += d; offTabStart=null; }
}

function buildSummaryObject(){
  const { fpsMed, latP95 } = metrics.read();
  const tabSum = tabLogger.getSummary?.() || {
    durationMs: performance.now() - sessionStart,
    offEpisodes: offTabEpisodes,
    offTotalMs: offTabAccumMs,
    onTotalMs: 0,
    longestOffMs: 0,
    offThresholdMs: 1500
  };
  const durationMs = Math.max(0, performance.now() - sessionStart);
  return {
    duration_ms: Math.round(durationMs),
    performance: {
      fps_median: Number(fpsMed.toFixed(1)),
      latency_p95_ms: Number(latP95.toFixed(1)),
      overall: perfAll?.textContent || ''
    },
    tab_activity: {
      off_episodes: tabSum.offEpisodes,
      off_total_ms: Math.round(tabSum.offTotalMs),
      on_total_ms: Math.round(tabSum.onTotalMs ?? 0),
      longest_off_ms: Math.round(tabSum.longestOffMs ?? 0),
      threshold_ms: tabSum.offThresholdMs ?? 1500
    },
    attention: {
      lookaway_episodes: lookAwayEpisodes,
      lookaway_total_ms: Math.round(lookAwayAccumMs),
      lookaway_longest_ms: Math.round(lookAwayLongestMs)
    },
    occlusion: {
      episodes: occlEpisodes,
      total_ms: Math.round(occlAccumMs),
      longest_ms: Math.round(occlLongestMs)
    },
    lips: {
      speak_episodes: lipsEpisodes,
      speak_total_ms: Math.round(lipsAccumMs),
      speak_longest_ms: Math.round(lipsLongestMs)
    }
  };
}

function showSummaryModal(summary){
  if (!summaryBody) return;
  const fmt = (ms)=>fmtTime(ms);
  summaryBody.innerHTML = `
    <p><strong>Duración:</strong> ${fmt(summary.duration_ms)}</p>
    <h4>Actividad de pestaña</h4>
    <ul>
      <li>Cambios fuera de pestaña (≥ ${summary.tab_activity.threshold_ms/1000}s): <strong>${summary.tab_activity.off_episodes}</strong></li>
      <li>Tiempo fuera: <strong>${fmt(summary.tab_activity.off_total_ms)}</strong></li>
    </ul>
    <h4>Desatención por mirada</h4>
    <ul>
      <li>Episodios: <strong>${summary.attention.lookaway_episodes}</strong></li>
      <li>Tiempo total: <strong>${fmt(summary.attention.lookaway_total_ms)}</strong></li>
      <li>Episodio más largo: <strong>${fmt(summary.attention.lookaway_longest_ms)}</strong></li>
    </ul>
    <h4>Rostro cubierto</h4>
    <ul>
      <li>Episodios: <strong>${summary.occlusion.episodes}</strong></li>
      <li>Tiempo total: <strong>${fmt(summary.occlusion.total_ms)}</strong></li>
    </ul>
    <h4>Posible habla</h4>
    <ul>
      <li>Episodios: <strong>${summary.lips.speak_episodes}</strong></li>
      <li>Tiempo total: <strong>${fmt(summary.lips.speak_total_ms)}</strong></li>
    </ul>
    <h4>Rendimiento</h4>
    <ul>
      <li>FPS mediana: <strong>${summary.performance.fps_median}</strong></li>
      <li>Latencia p95: <strong>${summary.performance.latency_p95_ms}</strong> ms</li>
      <li>Estado: <strong>${summary.performance.overall}</strong></li>
    </ul>
  `;
  summaryBackdrop?.classList.remove('hidden');
  summaryModal?.classList.remove('hidden');

  btnSumJSON?.addEventListener('click', ()=>{
    const blob = new Blob([JSON.stringify(summary, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'resumen_sesion_total.json'; a.click();
    URL.revokeObjectURL(a.href);
  }, { once:true });

  btnSumCSV?.addEventListener('click', ()=>{
    const rows = [
      ['duration_ms', summary.duration_ms],
      ['fps_median', summary.performance.fps_median],
      ['latency_p95_ms', summary.performance.latency_p95_ms],
      [],
      ['offtab_threshold_ms', summary.tab_activity.threshold_ms],
      ['offtab_episodes', summary.tab_activity.off_episodes],
      ['offtab_total_ms', summary.tab_activity.off_total_ms],
      ['offtab_longest_ms', summary.tab_activity.longest_off_ms],
      [],
      ['lookaway_episodes', summary.attention.lookaway_episodes],
      ['lookaway_total_ms', summary.attention.lookaway_total_ms],
      ['lookaway_longest_ms', summary.attention.lookaway_longest_ms],
      [],
      ['occlusion_episodes', summary.occlusion.episodes],
      ['occlusion_total_ms', summary.occlusion.total_ms],
      [],
      ['speak_episodes', summary.lips.speak_episodes],
      ['speak_total_ms', summary.lips.speak_total_ms],
    ];
    const csv = rows.map(r => (Array.isArray(r)? r.join(',') : '')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'resumen_sesion_total.csv'; a.click();
    URL.revokeObjectURL(a.href);
  }, { once:true });

  btnSumClose?.addEventListener('click', ()=>{
    summaryBackdrop?.classList.add('hidden');
    summaryModal?.classList.add('hidden');
  }, { once:true });
}

// Evidencias UI (si está el modal en la vista del estudiante)
btnEvid?.addEventListener('click', ()=>{
  if (!evGrid) return;
  evGrid.innerHTML = '';
  const items = evidence.list();
  if (!items.length){
    evGrid.innerHTML = `<div class="help">Aún no hay evidencias capturadas.</div>`;
  } else {
    for (const it of items){
      const card = document.createElement('div');
      card.className='ev-card';
      card.innerHTML = `<div class="pill pill-warn">${it.kind}</div>
        <img src="${it.data}" alt="${it.kind}"/>
        <div class="ev-note">${new Date(it.t).toLocaleTimeString()} — ${it.note||''}</div>`;
      evGrid.appendChild(card);
    }
  }
  evBackdrop?.classList.remove('hidden'); evModal?.classList.remove('hidden');
});
btnEvidClose?.addEventListener('click', ()=>{ evBackdrop?.classList.add('hidden'); evModal?.classList.add('hidden'); });
btnEvidDl?.addEventListener('click', ()=> evidence.downloadJSON() );

// ------------------------------------------------------------------
// Start / Stop
btnStart?.addEventListener('click', ()=>{
  if (!stream){ alert('Primero permite la cámara.'); return; }
  running = true;
  frameCount = 0;
  startedAtISO = new Date().toISOString();
  sessionStart = performance.now();

  // recibir resultado del examen
  window.addEventListener('exam:finished', (e) => {
    lastExamResult = e.detail;               // { correct, total } u otro shape
    updateLastAttemptExam?.(lastExamResult);
  }, { once: true });

  // Reset Off-tab
  offTabStart   = isInTab() ? null : performance.now();
  offTabEpisodes= 0;
  offTabAccumMs = 0;

  // Reset detección y episodios
  awayScore = 0; isLookAway = false; lookAwayStart = null; lookAwayEpisodes = 0; lookAwayAccumMs = 0; lookAwayLongestMs = 0;
  lipsScore = 0; lipsActive = false; lipsStart = null; lipsEpisodes = 0; lipsAccumMs = 0; lipsLongestMs = 0;
  isOccluded = false; occlSince = null; occlClearSince = null; occlEpStart = null; occlEpisodes = 0; occlAccumMs = 0; occlLongestMs = 0;
  lipsPrev = null; lipsVelEMA = 0; mouthHist.length = 0;
  blinkActive = false; blinkSince = null;

  calibrating = !!landmarker; calStart = performance.now();
  window.__c = {ar:[],off:[],yaw:[],pit:[],gz:[],gH:[],gV:[],mo:[]}; // para medianas

  evidence.clear();
  metrics.start();
  sessionStatus && (sessionStatus.textContent = 'Monitoreando');
  tabLogger.start?.();

  updateLiveEpisodeUI(performance.now());
  requestAnimationFrame(loop);
});

btnStop?.addEventListener('click', async ()=>{
  const now = performance.now();
  closeOpenEpisodes(now);

  running = false;
  metrics.stop();
  sessionStatus && (sessionStatus.textContent = 'Detenida');
  tabLogger.stopAndDownloadCSV?.();

  const summary = buildSummaryObject();
  showSummaryModal(summary);

  if (!lastExamResult) {
    try { lastExamResult = JSON.parse(localStorage.getItem('proctor.last_exam') || 'null'); } catch {}
  }

  const attempt = {
    id: `att_${Date.now().toString(36)}`,
    student: {
      name:  (studentName?.value || '').trim(),
      code:  (studentCode?.value || '').trim(),
      email: (studentEmail?.value || '').trim(),
    },
    startedAt: startedAtISO || new Date(Date.now() - summary.duration_ms).toISOString(),
    endedAt:   new Date().toISOString(),
    durationMs: Math.round(summary.duration_ms),
    summary,
    exam: lastExamResult || null,
    evidences: evidence.list().slice(-24)  // guarda últimas 24 con dataURL
  };

  // 1) local
  saveAttempt(attempt);
  // 2) backend
  await saveAttemptRemote(attempt);

  try { localStorage.removeItem('proctor.last_exam'); } catch {}
  console.log('[proctor] intento guardado:', attempt);
});

// ------------------------------------------------------------------
// Re-apertura / cambios de dispositivos
document.addEventListener('visibilitychange', async ()=>{
  if (document.visibilityState==='visible' && !stream && camRequested){ await startCamera(); }
});
navigator.mediaDevices?.addEventListener?.('devicechange', async ()=>{
  if (!stream && camRequested) await startCamera();
});

// ------------------------------------------------------------------
// Init
(function init(){
  if (!navigator.mediaDevices?.getUserMedia){ setCamStatus('err','No soportado','Usa Chrome/Edge.'); return; }
  if (insecureContext()){ setCamStatus('warn','HTTPS requerido','Abre con candado (HTTPS) o localhost.'); return; }
  setCamStatus('neutral','Permiso pendiente','Presiona “Permitir cámara”.');
  sessionStatus && (sessionStatus.textContent = 'Detenida');
  sessionTime && (sessionTime.textContent = '00:00');
  fpsEl&&(fpsEl.textContent='0'); p95El&&(p95El.textContent='0.0');
  tabState&&(tabState.textContent='—'); attnEl&&(attnEl.textContent='—'); lipsEl&&(lipsEl.textContent='—');
  offCntEl&&(offCntEl.textContent='0'); offTimeEl&&(offTimeEl.textContent='00:00');

  document.getElementById('open-privacy')
    ?.addEventListener('click', (e)=>{ e.preventDefault(); window.open('/privacidad.html','_blank','noopener'); });
})();

// ------------------------------------------------------------------
// Envío al backend
async function saveAttemptRemote(attempt) {
  try {
    // recorta evidencias para no pasar límites de payload
    const slim = { ...attempt, evidences: (attempt.evidences||[]).slice(-12) };
fetch('/api/attempt/create', { body: JSON.stringify(slim), ... })


    console.log('[proctor] POST /api/attempt/create', slim.id, 'ev:', slim.evidences.length);

    const res = await fetch('/api/attempt/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(slim)
    });

    const data = await res.json().catch(() => ({}));
    console.log('[proctor] API status', res.status, data);
  } catch (err) {
    console.error('[proctor] API error', err);
  }
}
