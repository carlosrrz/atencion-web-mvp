// app.js — Atención robusta: yaw column-major + ojos + auto-flip si la lógica está invertida
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
const MOVE_YAW  = 0.12;  // ~7°

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

/* Calibración / baseline / auto-flip */
let calibrating = false;
let calStart = 0;
let calAR = [], calOFF = [], calYAW = [], calGAZE = [];
let invertSense = false; // ← si true, invierte away/back detectados

// baseline y umbrales (se ajustan tras calibrar/adaptar)
let base = { ar: 0.68, off: 0.18, yaw: 0.04, gaze: 0.05 };
let thr  = {
  enter: { ar: 0.58, off: 0.28, yaw: 0.24, gaze: 0.35 },
  exit:  { ar: 0.62, off: 0.24, yaw: 0.16, gaze: 0.25 }
};

let ema = { ar: null, off: null, yaw: null, gaze: null };

/* ===== Util ===== */
const CONSENT_KEY = 'mvp.consent.v1';
const hasConsent  = () => { try { return !!localStorage.getItem(CONSENT_KEY); } catch { return false; } };
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

/* ===== Pose / Gaze helpers ===== */
// Matriz 4×4 en COLUMN-MAJOR: r00=m[0], r01=m[4], r02=m[8]; r10=m[1], r11=m[5], r12=m[9]; r20=m[2], r21=m[6], r22=m[10].
function yawMatA_colMajor(m){ return Math.abs(Math.atan2(m[8],  m[10])); } // atan2(r02, r22)
function yawMatB_colMajor(m){ return Math.abs(Math.atan2(-m[2], m[0])); }   // atan2(-r20, r00)

// Ojos externos (33 y 263): yaw ≈ atan2(Δz, Δx)
function yawFromEyes(lm){
  const L = lm[33], R = lm[263];
  if (!L || !R) return 0;
  const dz = (R.z - L.z);
  const dx = (R.x - L.x) + 1e-6;
  return Math.abs(Math.atan2(dz, dx));
}

// Offset lateral: centroide vs centro del bbox
function lateralOffset(lm, minx, maxx){
  const w = maxx - minx + 1e-6;
  const cx = (minx + maxx) / 2;
  let gx = 0; for (const p of lm) gx += p.x; gx /= lm.length;
  return Math.abs((gx - cx) / w);
}

// Gaze desde blendshapes: suma de magnitudes “look” (clipeado 0..1)
function gazeMagnitude(bs){
  if (!bs?.categories?.length) return 0;
  const pick = (name) => bs.categories.find(c => c.categoryName === name)?.score ?? 0;
  const parts = [
    'eyeLookUpLeft','eyeLookUpRight','eyeLookDownLeft','eyeLookDownRight',
    'eyeLookInLeft','eyeLookInRight','eyeLookOutLeft','eyeLookOutRight'
  ];
  const s = parts.reduce((a,n)=>a + pick(n), 0);
  return Math.min(1, s / parts.length); // promedio 0..1
}

function adaptBaseline(ar, off, yaw, gaze){
  const ALPHA = 0.02;      // adaptación lenta
  base.ar  = (1-ALPHA)*base.ar  + ALPHA*ar;
  base.off = (1-ALPHA)*base.off + ALPHA*off;
  base.yaw = (1-ALPHA)*base.yaw + ALPHA*yaw;
  base.gaze= (1-ALPHA)*base.gaze+ ALPHA*gaze;

  thr.enter.ar  = Math.max(0.50, base.ar  - 0.10);
  thr.exit.ar   = Math.max(thr.enter.ar + 0.04, base.ar - 0.03);
  thr.enter.off = Math.min(0.40, base.off + 0.10);
  thr.exit.off  = Math.min(0.34, base.off + 0.06);
  thr.enter.yaw = base.yaw + 0.20;
  thr.exit.yaw  = base.yaw + 0.14;
  thr.enter.gaze= base.gaze + 0.20;
  thr.exit.gaze = base.gaze + 0.12;
}

/* ===== Cámara ===== */
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

  // ---- Detección con yaw correcto + blendshapes + auto-flip ----
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
          const offRaw = lateralOffset(lm, minx, maxx);

          // yaw por ojos y matriz (column-major)
          const yawEyes = yawFromEyes(lm);
          let yawRaw = yawEyes;
          const M = out?.facialTransformationMatrixes?.[0];
          if (M && typeof M[0] === 'number') {
            const a = yawMatA_colMajor(M);
            const b = yawMatB_colMajor(M);
            yawRaw = (Math.abs(a - yawEyes) <= Math.abs(b - yawEyes)) ? a : b;
          }

          // gaze desde blendshapes
          const gazeRaw = gazeMagnitude(out?.faceBlendshapes?.[0]);

          // EMA
          ema.ar   = (ema.ar   == null) ? arRaw   : (1-EMA_ALPHA)*ema.ar   + EMA_ALPHA*arRaw;
          ema.off  = (ema.off  == null) ? offRaw  : (1-EMA_ALPHA)*ema.off  + EMA_ALPHA*offRaw;
          ema.yaw  = (ema.yaw  == null) ? yawRaw  : (1-EMA_ALPHA)*ema.yaw  + EMA_ALPHA*yawRaw;
          ema.gaze = (ema.gaze == null) ? gazeRaw : (1-EMA_ALPHA)*ema.gaze + EMA_ALPHA*gazeRaw;

          const dAR  = Math.abs(arRaw  - ema.ar);
          const dOFF = Math.abs(offRaw - ema.off);
          const dYAW = Math.abs(yawRaw - ema.yaw);
          const movementFast = (dOFF > MOVE_OFF) || (dAR > MOVE_AR) || (dYAW > MOVE_YAW);

          // Calibración inicial (mirando al frente)
          if (calibrating) {
            calAR.push(arRaw); calOFF.push(offRaw); calYAW.push(yawRaw); calGAZE.push(gazeRaw);
            if ((performance.now() - calStart) >= CALIBRATION_MS && calAR.length >= 6) {
              const med = a => { const s=[...a].sort((x,y)=>x-y), m=Math.floor(s.length/2); return s.length%2?s[m]:(s[m-1]+s[m])/2; };
              base.ar   = med(calAR);
              base.off  = med(calOFF);
              base.yaw  = med(calYAW);
              base.gaze = med(calGAZE);
              adaptBaseline(base.ar, base.off, base.yaw, base.gaze);
              calibrating = false;

              // --- AUTO-FLIP: si en el final de la calibración el sistema diría "away", invertimos
              const poseAwayEnter = (base.ar < thr.enter.ar) || (base.yaw > thr.enter.yaw);
              const transAwayEnter= (base.off > thr.enter.off) && (base.yaw > thr.exit.yaw * 0.7);
              const gazeAwayEnter = (base.gaze > thr.enter.gaze);
              const wouldBeAway   = poseAwayEnter || transAwayEnter || gazeAwayEnter;
              invertSense = !!wouldBeAway;
              console.log('Calibrado:', { base, thr, invertSense });
            }
          }

          // Umbrales vigentes + gating:
          const poseAwayEnter = (arRaw < thr.enter.ar) || (yawRaw > thr.enter.yaw);
          const poseAwayExit  = (arRaw > thr.exit.ar)  && (yawRaw < thr.exit.yaw);

          // offset solo ayuda si la pose sugiere desvío
          const transAwayEnter= (offRaw > thr.enter.off) && (yawRaw > thr.exit.yaw * 0.7);
          const transAwayExit = (offRaw < thr.exit.off);

          // ojos (gaze) también pueden disparar away
          const gazeAwayEnter = (gazeRaw > thr.enter.gaze);
          const gazeAwayExit  = (gazeRaw < thr.exit.gaze);

          let enter = poseAwayEnter || transAwayEnter || gazeAwayEnter;
          let exit  = poseAwayExit  && transAwayExit  && gazeAwayExit;

          // AUTO-FLIP (si la cámara/SDK invierten la “frontalidad”, corrije la decisión)
          if (invertSense) {
            const tmpEnter = enter;
            enter = exit;
            exit  = tmpEnter;
          }

          awayNow = movementFast || enter;
          backNow = !movementFast && exit;

          // Adaptación lenta cuando “atento”
          if (!isLookAway && !movementFast) {
            adaptBaseline(ema.ar, ema.off, ema.yaw, ema.gaze);
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
  calAR.length=0; calOFF.length=0; calYAW.length=0; calGAZE.length=0;
  ema = { ar: null, off: null, yaw: null, gaze: null };
  invertSense = false;

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
