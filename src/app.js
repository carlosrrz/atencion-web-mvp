// app.js — Mirada + Oclusión + Labios + Anti-blink + Off-tab + Resumen modal + Episodios en vivo
import { createMetrics } from './metrics.js';
import { createTabLogger } from './tab-logger.js';

// ===== saveAttempt robusto SIN top-level await =====
let saveAttempt = (attempt) => {
  try {
    const KEY = 'proctor.attempts.v1';
    const arr = JSON.parse(localStorage.getItem(KEY) || '[]');
    arr.push(attempt);
    localStorage.setItem(KEY, JSON.stringify(arr));
  } catch (e) { console.warn('[app] fallback saveAttempt error:', e); }
};

// Carga store.js en segundo plano con rutas alternativas (sin bloquear el módulo)
(async () => {
  try {
    const mod = await import('./store.js')
      .catch(() => import('../store.js'))
      .catch(() => import('../src/store.js'));
    if (mod?.saveAttempt) {
      saveAttempt = mod.saveAttempt;
      console.log('[app] saveAttempt listo (store.js encontrado)');
    }
  } catch (e) {
    console.warn('[app] No se encontró store.js; usando fallback local');
  }
})();


import { FilesetResolver, FaceLandmarker } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3";
import { saveAttempt, updateLastAttemptExam } from './store.js';


const studentName  = document.getElementById('student-name');
const studentCode  = document.getElementById('student-code');
const studentEmail = document.getElementById('student-email');



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
const lipsEl    = document.getElementById('lips-state');
const offCntEl  = document.getElementById('offtab-count');
const offTimeEl = document.getElementById('offtab-time');

const fpsEl   = document.getElementById('fps');
const p95El   = document.getElementById('p95');
const fpsPill = document.getElementById('fps-pill');
const p95Pill = document.getElementById('p95-pill');
const perfAll = document.getElementById('perf-overall');

/* Modal resumen */
const summaryBackdrop = document.getElementById('summary-backdrop');
const summaryModal    = document.getElementById('summary-modal');
const summaryBody     = document.getElementById('summary-body');
const btnSumJSON      = document.getElementById('summary-download-json');
const btnSumCSV       = document.getElementById('summary-download-csv');
const btnSumClose     = document.getElementById('summary-close');

/* Modal evidencias (opcional) */
const evBackdrop   = document.getElementById('evidence-backdrop');
const evModal      = document.getElementById('evidence-modal');
const evGrid       = document.getElementById('evidence-grid');
const btnEvid      = document.getElementById('btn-evidencias');
const btnEvidClose = document.getElementById('btn-evid-close');
const btnEvidDl    = document.getElementById('btn-evid-download');

/* ===== Evidencias ===== */
function createEvidence(){
  const items = []; // {t, kind, note, data}
  function snap(kind, note){
    try{
      const off = document.createElement('canvas');
      off.width = 320; off.height = 180;
      off.getContext('2d').drawImage(cam,0,0,off.width,off.height);
      items.push({ t: Date.now(), kind, note, data: off.toDataURL('image/jpeg',0.9) });
      if (items.length > 80) items.shift();
    }catch(e){}
  }
  function list(){ return items.slice(); }
  function clear(){ items.length=0; }
  function downloadJSON(){
    const blob = new Blob([JSON.stringify(items,null,2)],{type:'application/json'});
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'evidencias.json'; a.click();
    URL.revokeObjectURL(a.href);
  }
  return { snap, list, clear, downloadJSON };
}
const evidence = createEvidence();

/* ===== Parámetros (TU CONFIG “PRECISA”) ===== */
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

const SCORE_ENTER = 6;
const SCORE_EXIT  = 2;

/* ===== LABIOS (habla) — iguales a tu versión ===== */
const LIPS_SCORE_ENTER = 6;
const LIPS_SCORE_EXIT  = 2;
const LIPS_VEL_ALPHA = 0.5;
const LIPS_VEL_ENTER = 0.040;
const LIPS_VEL_EXIT  = 0.026;
const LIPS_WIN_MS    = 900;
const LIPS_OSC_MIN   = 2;
const LIPS_MIN_AMP   = 0.060;

/* ===== BLINK ===== */
const BLINK_ENTER = 0.55;
const BLINK_EXIT  = 0.35;
const BLINK_MAX_MS = 280;

/* ===== Estado ===== */
let awayScore   = 0;
let isLookAway  = false;

let lipsScore   = 0;
let lipsActive  = false;

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

// Off-tab (visibilidad O foco)
let offTabStart = null;
let offTabEpisodes = 0;
let offTabAccumMs = 0;

const metrics = createMetrics();
const tabLogger = createTabLogger({ offTabThresholdMs: 1500 });

/* Calibración / baseline / auto-flip */
let calibrating = false;
let calStart = 0;
let calAR = [], calOFF = [], calYAW = [], calPITCH = [], calGAZE = [];
let calGazeH = [], calGazeV = [];
let calMouth = [];
let invertSense = false;

let base = { ar: 0.68, off: 0.18, yaw: 0.04, pitch: 0.04, gaze: 0.05, gH: 0.00, gV: 0.00, mouth: 0.02 };
let thr  = {
  enter:{ ar:0.58, off:0.28, yaw:0.24, pitch:0.12, gaze:0.35, gH:0.28, gV:0.28, mouth:0.28 },
  exit: { ar:0.62, off:0.24, yaw:0.16, pitch:0.09, gaze:0.25, gH:0.20, gV:0.20, mouth:0.18 }
};
let ema = { ar:null, off:null, yaw:null, pitch:null, gaze:null, gH:null, gV:null, mouth:null };

/* Velocidad & ventana de labios */
let lipsPrev = null;    
let lipsVelEMA = 0;
let mouthHist = [];     

/* Episodios/tiempos (en vivo) */
let lookAwayStart = null, lookAwayEpisodes = 0, lookAwayAccumMs = 0, lookAwayLongestMs = 0;
let lipsStart     = null, lipsEpisodes     = 0, lipsAccumMs     = 0, lipsLongestMs     = 0;
let occlEpStart   = null, occlEpisodes     = 0, occlAccumMs     = 0, occlLongestMs     = 0;

/* ===== Util ===== */
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

/* ===== Pose / Gaze helpers ===== */
function yawMatA_colMajor(m){ return Math.abs(Math.atan2(m[8],  m[10])); }
function yawMatB_colMajor(m){ return Math.abs(Math.atan2(-m[2], m[0])); }
function pitchMatA_colMajor(m){ return Math.abs(Math.atan2(-m[9], m[10])); }
function pitchMatB_colMajor(m){ return Math.abs(Math.atan2(m[6],  m[5])); }
function yawFromEyes(lm){
  const L = lm[33], R = lm[263];
  if (!L || !R) return 0;
  const dz = (R.z - L.z);
  const dx = (R.x - L.x) + 1e-6;
  return Math.abs(Math.atan2(dz, dx));
}
function pitchFromFeatures(lm){
  const L = lm[33], R = lm[263], nose = lm[1] || lm[4] || lm[0];
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
  for (const p of lm){
    if (p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1) oob++;
  }
  return lm.length ? (oob / lm.length) : 1;
}
function gazeMagnitude(bs){
  if (!bs?.categories?.length) return 0;
  const pick = (name) => bs.categories.find(c => c.categoryName === name)?.score ?? 0;
  const parts = [
    'eyeLookUpLeft','eyeLookUpRight','eyeLookDownLeft','eyeLookDownRight',
    'eyeLookInLeft','eyeLookInRight','eyeLookOutLeft','eyeLookOutRight'
  ];
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
  return { h, v, hAbs, vAbs };
}

/* ===== Blendshapes helpers ===== */
function pickBS(bs, name){ return bs?.categories?.find(c => c.categoryName === name)?.score ?? 0; }

/* ===== BLINK ===== */
function blinkScore(bs){
  const L = pickBS(bs,'eyeBlinkLeft');
  const R = pickBS(bs,'eyeBlinkRight');
  return Math.max(L, R);
}
function updateBlink(bs, ts){
  const s = blinkScore(bs);
  if (!blinkActive && s >= BLINK_ENTER){
    blinkActive = true;
    blinkSince = ts;
  } else if (blinkActive){
    const dur = ts - (blinkSince ?? ts);
    if ((s <= BLINK_EXIT) || (dur > BLINK_MAX_MS)){
      blinkActive = false;
      blinkSince = null;
    }
  }
}

/* ===== LABIOS ===== */
function lipsComponents(bs){
  if (!bs) return null;
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
  const raw =
    0.50*comp.jaw +
    0.22*((comp.upper + comp.lower)/2) +
    0.18*comp.stretch +
    0.10*((comp.funnel + comp.pucker)/2) -
    0.10*comp.smile;
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
  let osc = 0;
  let prevDiff = null;
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

/* ===== Cámara + Modelo ===== */
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

/* ===== UI en vivo de episodios ===== */
let lookCntEl, lookTimeEl, occlCntEl, occlTimeEl, lipsCntEl, lipsTimeEl;
function ensureLiveEpisodeUI(){
  // intenta ubicar la card "Estado"
  const cards = Array.from(document.querySelectorAll('aside .card'));
  const estadoCard = cards.find(c => c.querySelector('h3')?.textContent?.trim().toLowerCase() === 'estado') || cards[1] || document.body;

  function ensureRow(html, id1, id2){
    if (!document.getElementById(id1) || !document.getElementById(id2)){
      const p = document.createElement('p');
      p.innerHTML = html;
      estadoCard.appendChild(p);
    }
  }


  lookCntEl  = document.getElementById('lookaway-count');
  lookTimeEl = document.getElementById('lookaway-time');
  occlCntEl  = document.getElementById('occl-count');
  occlTimeEl = document.getElementById('occl-time');
  lipsCntEl  = document.getElementById('lips-count');
  lipsTimeEl = document.getElementById('lips-time');
}
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

/* ===== Loop ===== */
function loop(){
  if (!running) return;
  if (cam.readyState < 2){ requestAnimationFrame(loop); return; }

  try{ ctx.drawImage(cam,0,0,canvas.width,canvas.height); }catch{}

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
      attnState = 'posible desconcentración/desatención (rostro cubierto)';
    } else if (isLookAway) {
      attnState = 'mirada desviada';
    }
    attnEl && (attnEl.textContent = attnState);

    lipsEl && (lipsEl.textContent = lipsActive ? 'movimiento (posible habla)' : '—');

    const accum = offTabAccumMs + (offTabStart ? (now - offTabStart) : 0);
    offTimeEl && (offTimeEl.textContent = fmtTime(accum));
    offCntEl  && (offCntEl.textContent  = String(offTabEpisodes));

    // ← actualización en vivo de episodios
    updateLiveEpisodeUI(now);
  }

  // ---- Detección robusta (try/catch) ----
  if (landmarker && frameCount % DETECT_EVERY === 0) {
    const ts = performance.now();
    let prevLook = isLookAway, prevLips = lipsActive, prevOcc = isOccluded;

    try {
      const out = landmarker.detectForVideo(cam, ts);
      const lm  = out?.faceLandmarks?.[0];
      const bs  = out?.faceBlendshapes?.[0];

      if (bs) updateBlink(bs, ts);

      // ===== OCLUSIÓN / SIN CARA =====
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

        // oclusión
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

          // yaw/pitch por ojos + matriz (si hay)
          const yawEyes = yawFromEyes(lm);
          let yawRaw = yawEyes;
          let pitchRaw = pitchFromFeatures(lm);

          const M = out?.facialTransformationMatrixes?.[0];
          if (M && typeof M[0] === 'number') {
            const yA = yawMatA_colMajor(M), yB = yawMatB_colMajor(M);
            const pA = pitchMatA_colMajor(M), pB = pitchMatB_colMajor(M);
            yawRaw   = (Math.abs(yA - yawEyes)   <= Math.abs(yB - yawEyes))   ? yA : yB;
            pitchRaw = (Math.abs(pA - pitchRaw)  <= Math.abs(pB - pitchRaw))  ? pA : pB;
          }

          // Gaze
          const gazeRaw = gazeMagnitude(bs);
          const { h:_, v:__, hAbs, vAbs } = gazeHV(bs);

          // LABIOS
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

          // Calibración
          if (calibrating) {
            calAR.push(arRaw); calOFF.push(offRaw); calYAW.push(yawRaw); calPITCH.push(pitchRaw); calGAZE.push(gazeRaw);
            calGazeH.push(hAbs); calGazeV.push(vAbs); calMouth.push(mouthRaw);
            if ((performance.now() - calStart) >= CALIBRATION_MS && calAR.length >= 6) {
              const med = a => { const s=[...a].sort((x,y)=>x-y), m=Math.floor(s.length/2); return s.length%2?s[m]:(s[m-1]+s[m])/2; };
              base.ar    = med(calAR);
              base.off   = med(calOFF);
              base.yaw   = med(calYAW);
              base.pitch = med(calPITCH);
              base.gaze  = med(calGAZE);
              base.gH    = med(calGazeH);
              base.gV    = med(calGazeV);
              base.mouth = med(calMouth);
              adaptBaseline(base.ar, base.off, base.yaw, base.pitch, base.gaze, base.gH, base.gV, base.mouth);
              calibrating = false;

              const poseAwayEnter = (base.ar < thr.enter.ar) || (base.yaw > thr.enter.yaw) || (base.pitch > thr.enter.pitch);
              const transAwayEnter= (base.off > thr.enter.off) && ((base.yaw > thr.exit.yaw*0.7) || (base.pitch > thr.exit.pitch*0.7));
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
          const transAwayEnter = (offRaw > thr.enter.off) && (yawRaw > thr.exit.yaw*0.7 || pitchRaw > thr.exit.pitch*0.7);
          const transAwayExit  = (offRaw < thr.exit.off);

          const headFrontal = (yawRaw < thr.exit.yaw) && (pitchRaw < thr.exit.pitch);
          const eyesAwayEnter = allowEyeMotion && headFrontal && (ema.gH > thr.enter.gH || ema.gV > thr.enter.gV);
          const eyesAwayExit  = allowEyeMotion ? ((ema.gH < thr.exit.gH) && (ema.gV < thr.exit.gV)) : true;

          const gazeAwayEnter  = allowEyeMotion && (ema.gaze > thr.enter.gaze);
          const gazeAwayExit   = allowEyeMotion ? (ema.gaze < thr.exit.gaze) : true;

          let enter = poseAwayEnter || transAwayEnter || eyesAwayEnter || gazeAwayEnter;
          let exit  = (poseAwayExit && transAwayExit && eyesAwayExit && gazeAwayExit);

          // Si la calibración detectó que tu baseline ya estaba "desviado",
          // // volteamos la lógica para no invertir "atento/mirada".
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


            if (!isLookAway && !movementFast) {
              adaptBaseline(ema.ar, ema.off, ema.yaw, ema.pitch, ema.gaze, ema.gH, ema.gV, ema.mouth);
            }
          } else {
            awayNow = false;
            backNow = true;
            awayScore = 0;  isLookAway = false;
            lipsScore = 0;  lipsActive = false;
            lipsPrev = null; lipsVelEMA = 0;
            blinkActive = false; blinkSince = null;
          }
        }
      }

      // Histéresis temporal (mirada)
      if (!isOccluded) {
        if (awayNow)      awayScore = Math.min(SCORE_ENTER, awayScore + 3);
        else if (backNow) awayScore = Math.max(0, awayScore - 2);
        else              awayScore = Math.max(0, awayScore - 1);
        if (!isLookAway && awayScore >= SCORE_ENTER){ 
          isLookAway = true; 
          evidence.snap?.('alert/lookAway','Mirada desviada'); 
        }
        if (isLookAway  && awayScore <= SCORE_EXIT)  isLookAway = false;
      }

      // Histéresis temporal (labios)
      if (!isOccluded) {
        if (lipsNow)        lipsScore = Math.min(LIPS_SCORE_ENTER, lipsScore + 3);
        else if (lipsBack)  lipsScore = Math.max(0, lipsScore - 2);
        else                lipsScore = Math.max(0, lipsScore - 1);
        if (!lipsActive && lipsScore >= LIPS_SCORE_ENTER){ 
          lipsActive = true; 
          evidence.snap?.('alert/speech','Posible habla'); 
        }
        if (lipsActive  && lipsScore <= LIPS_SCORE_EXIT)  lipsActive = false;
      }

    } catch (err) {
      // no romper el loop si detect falla
    }

    // ===== Episodios (transiciones) =====
    // Mirada
    if (!prevLook && isLookAway) {
      lookAwayStart = ts;
    } else if (prevLook && !isLookAway) {
      if (lookAwayStart != null) {
        const d = ts - lookAwayStart;
        lookAwayAccumMs += d; lookAwayEpisodes += 1; if (d > lookAwayLongestMs) lookAwayLongestMs = d;
        lookAwayStart = null;
      }
    }
    // Labios
    if (!prevLips && lipsActive) {
      lipsStart = ts;
    } else if (prevLips && !lipsActive) {
      if (lipsStart != null) {
        const d = ts - lipsStart;
        lipsAccumMs += d; lipsEpisodes += 1; if (d > lipsLongestMs) lipsLongestMs = d;
        lipsStart = null;
      }
    }
    // Oclusión
    if (!prevOcc && isOccluded) {
      occlEpStart = ts;
      evidence.snap?.('alert/occlusion','Rostro cubierto/fuera');
    } else if (prevOcc && !isOccluded) {
      if (occlEpStart != null) {
        const d = ts - occlEpStart;
        occlAccumMs += d; occlEpisodes += 1; if (d > occlLongestMs) occlLongestMs = d;
        occlEpStart = null;
      }
    }
  }

  requestAnimationFrame(loop);
}

/* ===== Off-tab: visibilidad O foco ===== */
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
tabLogger.setOnAlert?.((type)=>{ if (type==='off_tab') evidence.snap?.('alert/off_tab','Fuera de pestaña ≥ umbral'); });

/* ===== Botones ===== */
btnPermitir?.addEventListener('click', async ()=>{
  camRequested = true;
  await startCamera();
});
btnRetry?.addEventListener('click', ()=>{
  releaseStream();
  setCamStatus('neutral','Permiso pendiente','Presiona “Permitir cámara”.');
});

function closeOpenEpisodes(nowTs){
  // mirada
  if (lookAwayStart != null){
    const d = nowTs - lookAwayStart;
    lookAwayAccumMs += d; lookAwayEpisodes += 1; if (d > lookAwayLongestMs) lookAwayLongestMs = d;
    lookAwayStart = null;
  }
  // labios
  if (lipsStart != null){
    const d = nowTs - lipsStart;
    lipsAccumMs += d; lipsEpisodes += 1; if (d > lipsLongestMs) lipsLongestMs = d;
    lipsStart = null;
  }
  // oclusión
  if (occlEpStart != null){
    const d = nowTs - occlEpStart;
    occlAccumMs += d; occlEpisodes += 1; if (d > occlLongestMs) occlLongestMs = d;
    occlEpStart = null;
  }
  // off-tab
  if (offTabStart != null){
    const d = nowTs - offTabStart;
    if (d >= 1500) offTabEpisodes += 1;
    offTabAccumMs += d;
    offTabStart = null;
  }
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
      on_total_ms: Math.round(tabSum.onTotalMs),
      longest_off_ms: Math.round(tabSum.longestOffMs),
      threshold_ms: tabSum.offThresholdMs
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

  // Descargas
  btnSumJSON?.addEventListener('click', ()=>{
    const blob = new Blob([JSON.stringify(summary, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'resumen_sesion_total.json';
    a.click();
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
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'resumen_sesion_total.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  }, { once:true });

  btnSumClose?.addEventListener('click', ()=>{
    summaryBackdrop?.classList.add('hidden');
    summaryModal?.classList.add('hidden');
  }, { once:true });
}

/* Evidencias UI (si existen en el HTML) */
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

/* Start/Stop */
btnStart?.addEventListener('click', ()=>{
  if (!stream){ alert('Primero permite la cámara.'); return; }
  running = true;
  frameCount = 0;
  let startedAtISO = null; // declara cerca de tus estados globales
  startedAtISO = new Date().toISOString();
  sessionStart = performance.now();
  
  let lastExamResult = null;
  window.addEventListener('exam:finished', (e) => {
    lastExamResult = e.detail;               // { correct, total }
    updateLastAttemptExam?.(lastExamResult); // por si ya se guardó un intento previo
    });

  
  // Off-tab
  offTabStart   = isInTab() ? null : performance.now();
  offTabEpisodes= 0;
  offTabAccumMs = 0;

  // reset detección y episodios
  awayScore = 0; isLookAway = false; lookAwayStart = null; lookAwayEpisodes = 0; lookAwayAccumMs = 0; lookAwayLongestMs = 0;
  lipsScore = 0; lipsActive = false; lipsStart = null; lipsEpisodes = 0; lipsAccumMs = 0; lipsLongestMs = 0;
  isOccluded = false; occlSince = null; occlClearSince = null; occlEpStart = null; occlEpisodes = 0; occlAccumMs = 0; occlLongestMs = 0;
  lipsPrev = null; lipsVelEMA = 0; mouthHist.length = 0;
  blinkActive = false; blinkSince = null;

  calibrating = !!landmarker; calStart = performance.now();
  calAR.length=0; calOFF.length=0; calYAW.length=0; calPITCH.length=0; calGAZE.length=0;
  calGazeH.length=0; calGazeV.length=0; calMouth.length=0;
  ema = { ar: null, off: null, yaw: null, pitch: null, gaze: null, gH: null, gV: null, mouth: null };
  invertSense = false;

  evidence.clear();
  metrics.start();

  sessionStatus && (sessionStatus.textContent = 'Monitoreando');
  tabLogger.start?.();

  ensureLiveEpisodeUI();          // ← crea los spans si no existen
  updateLiveEpisodeUI(performance.now());

  requestAnimationFrame(loop);
});

btnStop?.addEventListener('click', ()=>{
  const now = performance.now();
  // cierra episodios abiertos
  closeOpenEpisodes(now);

  // detener pipeline/UI
  running = false;
  metrics.stop();
  sessionStatus && (sessionStatus.textContent = 'Detenida');

  // export de actividad de pestaña
  tabLogger.stopAndDownloadCSV?.();

  // resumen + modal
  const summary = buildSummaryObject();
  showSummaryModal(summary);

  // ===== Guardar intento para el panel del profesor =====
try {
  const endedAtISO = new Date().toISOString();
  // examen (si existe)
  let examSum = window.__examSummary;
  if (!examSum) {
    try { examSum = JSON.parse(localStorage.getItem('proctor.last_exam') || 'null'); } catch {}
  }

  // evidencias: limita a las últimas 24 para no saturar localStorage
  const evid = Array.isArray(evidence.list?.()) ? evidence.list() : [];
  const evidSlim = evid.slice(-24);

  const attempt = {
    id: String(Date.now()),
    student: {
      name: (studentName?.value || '').trim(),
      code: (studentCode?.value || '').trim(),
      email: (studentEmail?.value || '').trim(),
    },
    startedAt: startedAtISO || endedAtISO,
    endedAt: endedAtISO,
    durationMs: summary.duration_ms,
    summary,          // ← todo el resumen (tab_activity, attention, lips, occlusion, performance)
    exam: examSum || null,
    evidences: evidSlim
  };

  saveAttempt(attempt);
  try { localStorage.removeItem('proctor.last_exam'); } catch {}

  console.log('[proctor] intento guardado:', attempt);
} catch (e) {
  console.warn('No se pudo guardar el intento:', e);
}


  // ==== NUEVO: guardar intento con evidencias y datos del alumno ====
const attempt = {
  id: `att_${Date.now().toString(36)}`,
  student: {
    name:  studentName?.value?.trim()  || '',
    code:  studentCode?.value?.trim()  || '',
    email: studentEmail?.value?.trim() || ''
  },
  startedAt: startedAtISO || new Date(Date.now() - summary.duration_ms).toISOString(),
  endedAt:   new Date().toISOString(),
  durationMs: Math.round(summary.duration_ms),
  summary,
  evidence: (typeof evidence?.list === 'function') ? evidence.list() : [],
  exam: lastExamResult || null
};
saveAttempt(attempt);
// ================================================================
});

// Re-apertura / dispositivos
document.addEventListener('visibilitychange', async ()=>{
  if (document.visibilityState==='visible' && !stream && camRequested){
    await startCamera();
  }
});
navigator.mediaDevices?.addEventListener?.('devicechange', async ()=>{
  if (!stream && camRequested) await startCamera();
});

/* ===== Init ===== */
(function init(){
  if (!navigator.mediaDevices?.getUserMedia){ setCamStatus('err','No soportado','Usa Chrome/Edge.'); return; }
  if (insecureContext()){ setCamStatus('warn','HTTPS requerido','Abre con candado (HTTPS) o localhost.'); return; }
  setCamStatus('neutral','Permiso pendiente','Presiona “Permitir cámara”.');
  sessionStatus && (sessionStatus.textContent = 'Detenida');
  sessionTime && (sessionTime.textContent = '00:00');
  fpsEl&&(fpsEl.textContent='0'); p95El&&(p95El.textContent='0.0');
  tabState&&(tabState.textContent='—'); attnEl&&(attnEl.textContent='—');
  lipsEl&&(lipsEl.textContent='—');
  offCntEl&&(offCntEl.textContent='0'); offTimeEl&&(offTimeEl.textContent='00:00');

  // Prepara los contadores en vivo si aún no existen
  ensureLiveEpisodeUI();

  // Enlace de privacidad (si mantienes esa opción)
  document.getElementById('open-privacy')
    ?.addEventListener('click', (e)=>{ e.preventDefault(); window.open('/privacidad.html','_blank','noopener'); });
})();