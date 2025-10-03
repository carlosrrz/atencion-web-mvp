// src/app.js
import { createMetrics } from './metrics.js';
import { createTabLogger } from './tab-logger.js';

/* ==== Referencias de UI ==== */
const cam = document.getElementById('cam');
const canvas = document.getElementById('canvas');
const btnPermitir = document.getElementById('btn-permitir');
const btnRetry = document.getElementById('btn-reintentar');
const btnStart = document.getElementById('btn-start');
const btnStop = document.getElementById('btn-stop');

const camStatus = document.getElementById('cam-status');
const camHelp   = document.getElementById('cam-help');

const tabState = document.getElementById('tab-state');
const attn = document.getElementById('attn-state');
const fpsEl = document.getElementById('fps');
const p95El = document.getElementById('p95');

// Umbrales RN-001
const PERF_THRESH = {
  fps: { green: 24, amber: 18 },       // ≥24 OK, 18–23 ámbar, <18 rojo
  p95: { green: 200, amber: 350 }      // ≤200 OK, 201–350 ámbar, >350 rojo
};

// Accesos a los "pills"
const fpsPill = document.getElementById('fps-pill');
const p95Pill = document.getElementById('p95-pill');
const overallPill = document.getElementById('perf-overall');

function levelForFPS(fps) {
  if (fps >= PERF_THRESH.fps.green) return 'ok';
  if (fps >= PERF_THRESH.fps.amber) return 'warn';
  return 'err';
}
function levelForP95(ms) {
  if (ms <= PERF_THRESH.p95.green) return 'ok';
  if (ms <= PERF_THRESH.p95.amber) return 'warn';
  return 'err';
}
function setPill(el, level, label) {
  if (!el) return;
  el.classList.remove('pill-neutral','pill-ok','pill-warn','pill-err');
  el.classList.add('pill', `pill-${level}`);
  el.textContent = label;
  el.setAttribute('data-level', level);
  el.setAttribute('aria-label', `Estado ${label}`);
}
function overallFrom(levelA, levelB) {
  const rank = { ok: 0, warn: 1, err: 2 };
  return (rank[levelA] >= rank[levelB]) ? levelA : levelB; // el peor manda
}
function updatePerfIndicators(fpsMed, latP95) {
  const lvFps = levelForFPS(fpsMed);
  const lvP95 = levelForP95(latP95);
  setPill(fpsPill, lvFps, lvFps === 'ok' ? '🟢' : lvFps === 'warn' ? '🟠' : '🔴');
  setPill(p95Pill, lvP95, lvP95 === 'ok' ? '🟢' : lvP95 === 'warn' ? '🟠' : '🔴');
  const ov = overallFrom(lvFps, lvP95);
  setPill(overallPill, ov, ov === 'ok' ? '🟢 Óptimo' : ov === 'warn' ? '🟠 Atención' : '🔴 Riesgo');
}


/* HU-010: tabs y cronómetro */
const tabButtons = document.querySelectorAll('.tab');
const lecturaSec = document.getElementById('lectura');
const videoSec   = document.getElementById('video');
let frameCount = 0;
let sessionStart = 0;
const sessionStatus = document.getElementById('session-status');
const sessionTime   = document.getElementById('session-time');
const examSec   = document.getElementById('examen');  // NUEVO

/* (opcionales en HTML; si no existen, no rompe) */
const yawEl   = document.getElementById('yaw')   || { textContent: '' };
const blinkEl = document.getElementById('blink') || { textContent: '' };

/* ==== Estado general ==== */
const ctx = canvas.getContext('2d');
const metrics = createMetrics();
const tabLogger = createTabLogger();

let stream = null;
let running = false;
let camRequested = false; // solo reconectar si el usuario lo pidió explícitamente


// === Consentimiento (RN-009) ===
const consentBackdrop = document.getElementById('consent-backdrop');
const consentModal    = document.getElementById('consent-modal');
const consentAccept   = document.getElementById('consent-accept');
const consentCancel   = document.getElementById('consent-cancel');
const consentCheck    = document.getElementById('consent-check');

// Si tu link del header es <a id="open-privacy">Privacidad</a>, también abrirá el modal:
document.getElementById('open-privacy')?.addEventListener('click', (e) => {
  e.preventDefault(); showConsent();
});

const CONSENT_KEY = 'mvp.consent.v1';
function hasConsent() {
  try { return !!localStorage.getItem(CONSENT_KEY); } catch { return false; }
}
function setConsent() {
  try { localStorage.setItem(CONSENT_KEY, JSON.stringify({ v: 1, ts: Date.now() })); } catch {}
}
function clearConsent() { try { localStorage.removeItem(CONSENT_KEY); } catch {} }

function showConsent() {
  consentCheck.checked = false;
  consentAccept.disabled = true;
  consentBackdrop.classList.remove('hidden');
  consentModal.classList.remove('hidden');
  consentCheck.focus();
}
function hideConsent() {
  consentBackdrop.classList.add('hidden');
  consentModal.classList.add('hidden');
}
consentCheck?.addEventListener('change', () => {
  consentAccept.disabled = !consentCheck.checked;
});
consentCancel?.addEventListener('click', hideConsent);
consentAccept?.addEventListener('click', () => { setConsent(); hideConsent(); });


/* HU-010: control de cronómetro de sesión */
let t0 = 0;
let timerId = null;
function fmtMMSS(ms) {
  const s = Math.floor(ms/1000);
  const mm = String(Math.floor(s/60)).padStart(2,'0');
  const ss = String(s%60).padStart(2,'0');
  return `${mm}:${ss}`;
}
function startTimer() {
  t0 = Date.now();
  sessionStatus.textContent = 'Monitoreando';
  sessionTime.textContent = '00:00';
  clearInterval(timerId);
  timerId = setInterval(() => {
    sessionTime.textContent = fmtMMSS(Date.now() - t0);
  }, 500);
}
function stopTimer() {
  clearInterval(timerId);
  timerId = null;
  sessionStatus.textContent = 'Detenida';
}

/* HU-010: tabs Lectura/Video */
function switchTab(which) {
  tabButtons.forEach(b => b.classList.toggle('active', b.dataset.t === which));
  lecturaSec.classList.toggle('hidden', which !== 'lectura');
  videoSec.classList.toggle('hidden',   which !== 'video');
  examSec.classList.toggle('hidden',    which !== 'examen');
}
tabButtons.forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.t));
});

/* =========================
   HU-002: utilidades de estado de cámara
   ========================= */
function insecureContext() {
  return !(location.protocol === 'https:' || location.hostname === 'localhost');
}
function setCamStatus(kind, msg, help = '') {
  camStatus.className = 'pill ' + (
    kind === 'ok'   ? 'pill-ok'   :
    kind === 'warn' ? 'pill-warn' :
    kind === 'err'  ? 'pill-err'  : 'pill-neutral'
  );
  camStatus.textContent = msg;
  if (help) { camHelp.textContent = help; camHelp.classList.remove('hidden'); }
  else { camHelp.classList.add('hidden'); }
}
async function hasVideoInput() {
  if (!navigator.mediaDevices?.enumerateDevices) return false;
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.some(d => d.kind === 'videoinput');
}

/* =========================
   BU-001: permisos y recuperación robusta
   ========================= */
async function getCamPermissionState() {
  if (!navigator.permissions?.query) return null;
  try {
    const st = await navigator.permissions.query({ name: 'camera' });
    return st.state; // 'granted' | 'denied' | 'prompt'
  } catch { return null; }
}
async function watchCameraPermission() {
  if (!navigator.permissions?.query) return;
  try {
    const st = await navigator.permissions.query({ name: 'camera' });
    const apply = (state) => {
      if (state === 'denied') setCamStatus('err', 'Permiso denegado', 'Habilita la cámara en el candado del navegador y presiona Reintentar.');
      if (state === 'prompt') setCamStatus('neutral', 'Permiso pendiente', 'Presiona “Permitir cámara” para iniciar.');
    };
    apply(st.state);
    st.onchange = () => apply(st.state);
  } catch {}
}
function releaseStream() {
  try { stream?.getTracks().forEach(t => t.stop()); } catch {}
  stream = null;
}
function attachStreamHandlers(s) {
  const vt = s.getVideoTracks?.()[0];
  if (!vt) return;
  vt.addEventListener?.('ended', () => {
    setCamStatus('warn', 'Flujo de cámara finalizado', 'Cierra otras apps que usen la cámara y presiona Reintentar.');
    releaseStream();
  });
}

/* Intento con fallback: 720p -> 480p -> 320p */
async function openCameraWithFallback() {
  const configs = [
    { width: 1280, height: 720 },
    { width: 640,  height: 480 },
    { width: 320,  height: 240 }
  ];
  let lastErr = null;
  for (const cfg of configs) {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: cfg });
      return { stream: s, label: `${cfg.width}x${cfg.height}` };
    } catch (e) {
      lastErr = e;
      if (e.name === 'NotAllowedError' || e.name === 'SecurityError') throw e;
    }
  }
  throw lastErr;
}
async function startCamera() {
  if (insecureContext()) {
    setCamStatus('warn', 'HTTPS requerido', 'Abre la app en HTTPS o localhost, luego Reintentar.');
    return;
  }
  try {
    const { stream: s, label } = await openCameraWithFallback();
    stream = s;
    cam.srcObject = stream;
    // Arranca el video y ajusta tamaño del canvas
    try { await cam.play(); } catch {}
    cam.onloadedmetadata = () => {
      canvas.width  = cam.videoWidth;
      canvas.height = cam.videoHeight;
    };
    // Para preview: mostrar video y ocultar overlay
    cam.classList.remove('hidden');
    canvas.classList.add('hidden');

    cam.onloadedmetadata = () => {
      canvas.width  = cam.videoWidth;
      canvas.height = cam.videoHeight;
    };
    attachStreamHandlers(stream);
    setCamStatus('ok', `Listo (${label})`, 'La cámara está activa. Puedes Iniciar la evaluación.');
  } catch (e) {
    if (e.name === 'NotAllowedError' || e.name === 'SecurityError') {
      setCamStatus('err', 'Permiso denegado', 'Haz clic en el candado → Cámara: Permitir. Luego Reintentar.');
    } else if (e.name === 'NotFoundError' || e.name === 'OverconstrainedError') {
      setCamStatus('err', 'Sin cámara disponible', 'Conecta/selecciona una webcam y presiona Reintentar.');
    } else if (e.name === 'NotReadableError') {
      setCamStatus('warn', 'Cámara ocupada', 'Cierra Zoom/Meet/Teams y presiona Reintentar.');
    } else {
      setCamStatus('err', 'Error de cámara', `Detalle: ${e.name}. Usa Reintentar o recarga la página.`);
    }
  }
}

/* Estado inicial al cargar + vigilancia de permiso */
(async function initCameraStatus() {
  // Tabs por defecto
  switchTab('lectura');

  if (!navigator.mediaDevices?.getUserMedia) {
    setCamStatus('err', 'No soportado', 'Este navegador no soporta cámara (getUserMedia). Prueba Chrome/Edge.');
    return;
  }
  if (insecureContext()) {
    setCamStatus('warn', 'HTTPS requerido', 'Abre la app con candado (HTTPS) o en localhost.');
    return;
  }
  try {
    const anyCam = await hasVideoInput();
    if (!anyCam) setCamStatus('err', 'Sin cámara detectada', 'Conecta una webcam o habilita la integrada y reintenta.');
    else setCamStatus('neutral', 'Permiso pendiente', 'Presiona “Permitir cámara” para iniciar.');
  } catch {
    setCamStatus('neutral', 'Permiso pendiente', 'Presiona “Permitir cámara” para iniciar.');
  }
  watchCameraPermission();
})();

/* Reintentos suaves por visibilidad/dispositivos */
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible' && !stream && camRequested && hasConsent()) {
    const st = await getCamPermissionState?.(); // si tienes este helper
    if (!st || st === 'granted') await startCamera();
  }
});

navigator.mediaDevices?.addEventListener?.('devicechange', async () => {
  if (!stream && camRequested && hasConsent()) await startCamera();
});



/* ==== TA-001: MediaPipe Face Landmarker (yaw + blink) ==== */
let mpReady = false;
let faceLandmarker = null;

// Extrae yaw (grados) desde la matriz 4x4
function yawFromMatrix(m) {
  const m00 = m[0], m10 = m[1], m20 = m[2];
  const yaw = Math.atan2(-m20, Math.hypot(m00, m10));
  return yaw * 180 / Math.PI;
}
// Promedio del blink de ambos ojos
function eyesClosedScore(blend) {
  if (!blend?.categories?.length) return 0;
  const cats = blend.categories;
  const get = (name) => cats.find(c => c.categoryName === name)?.score ?? 0;
  return (get('eyeBlinkLeft') + get('eyeBlinkRight')) / 2;
}
async function ensureMediaPipe() {
  if (mpReady && faceLandmarker) return;
  const vision = await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.13');
  const { FilesetResolver, FaceLandmarker } = vision;
  const fileset = await FilesetResolver.forVisionTasks(
    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.13/wasm'
  );
  faceLandmarker = await FaceLandmarker.createFromOptions(fileset, {
    baseOptions: {
      modelAssetPath:
        'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'
    },
    outputFaceBlendshapes: true,
    outputFacialTransformationMatrixes: true,
    runningMode: 'VIDEO',
    numFaces: 1
  });
  mpReady = true;
  console.log('[MP] Face Landmarker listo');
}
function predictMP(videoEl) {
  if (!mpReady || !faceLandmarker) return null;
  const ts = performance.now();
  const out = faceLandmarker.detectForVideo(videoEl, ts);
  if (!out?.faceLandmarks?.length) {
    return { yawDeg: 0, blink: 0, label: 'sin_rostro', score: 0 };
  }
  const mats = out.facialTransformationMatrixes;
  const yawDeg = mats?.length ? yawFromMatrix(mats[0].data) : 0;
  const blink = eyesClosedScore(out.faceBlendshapes?.[0]);
  let label = 'atento', score = 1 - blink;
  if (blink >= 0.6) { label = 'ojos_cerrados'; score = blink; }
  else if (Math.abs(yawDeg) >= 25) { label = 'cabeza_girada'; score = Math.min(1, Math.abs(yawDeg)/45); }
  return { yawDeg, blink, label, score };
}

/* ==== Loop de render + métricas ==== */
let uiCounter = 0;
function loop() {
  if (!running) return;

  // Espera a que el video tenga datos
  if (cam.readyState < 2) {
    requestAnimationFrame(loop);
    return;
  }

  const t0 = metrics.onFrameStart();
  ctx.drawImage(cam, 0, 0, canvas.width, canvas.height);
  metrics.onFrameEnd(t0);

  // Actualiza UI cada ~10 frames
  frameCount++;
  if (frameCount % 10 === 0) {
    const { fpsMed, latP95 } = metrics.read();
    fpsEl.textContent = fpsMed;
    p95El.textContent = latP95;
    updatePerfIndicators?.(fpsMed, latP95);  // si implementaste RN-001

    // Timer de sesión
    const ms = performance.now() - sessionStart;
    const s  = Math.floor(ms / 1000);
    const mm = String(Math.floor(s / 60)).padStart(2, '0');
    const ss = String(s % 60).padStart(2, '0');
    sessionTime.textContent = `${mm}:${ss}`;

    // Estado pestaña
    tabState.textContent = document.visibilityState === 'visible' ? 'En pestaña' : 'Fuera de pestaña';
  }

  requestAnimationFrame(loop);
}


  // Dibuja frame
  ctx.drawImage(cam, 0, 0, canvas.width, canvas.height);

  // Inferencia MediaPipe cada ~2 frames (throttling)
  if (mpReady) {
    if (!loop._i) loop._i = 0;
    if ((loop._i++ % 2) === 0) {
      const pred = predictMP(cam);
      if (pred) {
        yawEl.textContent = pred.yawDeg.toFixed(1);
        blinkEl.textContent = pred.blink.toFixed(2);
        attn.textContent = pred.label;
      }
    }
  }

  metrics.onFrameEnd(t0);

  // Actualiza HUD cada ~15 frames
  if (++uiCounter % 15 === 0) {
    const { fpsMed, latP95 } = metrics.read();
    fpsEl.textContent = Math.round(fpsMed);
    p95El.textContent = latP95.toFixed(1);
    tabState.textContent = document.visibilityState === 'visible' ? 'En pestaña' : 'Fuera de pestaña';
    updatePerfIndicators(fpsMed, latP95);
  }
  requestAnimationFrame(loop);
}

/* ==== Botones ==== */
btnPermitir.onclick = async () => {
  if (!hasConsent()) { showConsent(); return; }
  camRequested = true;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 } });
    cam.srcObject = stream;
    await cam.play?.();

    const setDims = () => {
      // Usa dimensiones reales del video
      if (cam.videoWidth && cam.videoHeight) {
        canvas.width = cam.videoWidth;
        canvas.height = cam.videoHeight;
      } else {
        // fallback a 640x360 si aún no hay metadata
        canvas.width = 640; canvas.height = 360;
      }
    };
    if (cam.readyState >= 2) setDims();
    else cam.addEventListener('loadedmetadata', setDims, { once: true });

    setCamStatus('ok', `Listo (${cam.videoWidth || 1280}x${cam.videoHeight || 720})`,
                 'La cámara está activa. Puedes Iniciar la evaluación.');
  } catch (e) {
    // ... tu manejo de errores existente
  }
};


btnRetry.onclick = async () => {
  releaseStream();
  camRequested = false; // opcional: pedir de nuevo intención
  setCamStatus('neutral', 'Permiso pendiente', 'Presiona “Permitir cámara” para iniciar.');
};

btnStart.onclick = () => {
  if (!hasConsent()) { showConsent(); return; }
  if (!stream) { alert('Primero permite la cámara.'); return; }
  running = true;
  frameCount = 0;
  sessionStart = performance.now();
  sessionStatus.textContent = 'Monitoreando';
  loop();
};

btnStop.onclick = () => {
  running = false;
  sessionStatus.textContent = 'Detenida';
  tabLogger.stopAndDownloadCSV();
};


    // ⬇️ NUEVO: calcular y mostrar resumen de off-tab
  const summary = tabLogger.getSummary();
  const offEp   = document.getElementById('off-episodes');
  const offTime = document.getElementById('off-time');
  if (offEp)   offEp.textContent = String(summary.offEpisodes);
  if (offTime) offTime.textContent = fmtMMSS(summary.offTotalMs);

  // ⬇️ NUEVO: descargar resumen (elige JSON o CSV)
  tabLogger.downloadSummaryJSON('resumen_sesion.json');
  // tabLogger.downloadSummaryCSV('resumen_sesion.csv');
  
  stopTimer();                             // HU-010: detiene cronómetro
  btnStart.disabled = false;
  btnStop.disabled  = true;
  canvas.classList.add('hidden');
  cam.classList.remove('hidden');
};
