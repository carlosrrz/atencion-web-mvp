// src/app.js
import { createMetrics } from './metrics.js';
import { createTabLogger } from './tab-logger.js';

const cam = document.getElementById('cam');
const canvas = document.getElementById('canvas');
const btnPermitir = document.getElementById('btn-permitir');
const btnStart = document.getElementById('btn-start');
const btnStop = document.getElementById('btn-stop');
const tabState = document.getElementById('tab-state');
const attn = document.getElementById('attn-state');
const fpsEl = document.getElementById('fps');
const p95El = document.getElementById('p95');

// HU-002: elementos de estado de cámara
const camStatus = document.getElementById('cam-status');
const camHelp   = document.getElementById('cam-help');
const btnRetry  = document.getElementById('btn-reintentar');

// TA-001: (opcional) elementos para mostrar yaw y blink si existen en el HTML
const yawEl   = document.getElementById('yaw')   || { textContent: '' };
const blinkEl = document.getElementById('blink') || { textContent: '' };

const ctx = canvas.getContext('2d');
const metrics = createMetrics();
const tabLogger = createTabLogger();

let stream = null;
let running = false;

/* =========================
   HU-002 (estado de cámara)
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
  if (help) {
    camHelp.textContent = help;
    camHelp.classList.remove('hidden');
  } else {
    camHelp.classList.add('hidden');
  }
}
async function hasVideoInput() {
  if (!navigator.mediaDevices?.enumerateDevices) return false;
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.some(d => d.kind === 'videoinput');
}

// Estado inicial al cargar
(async function initCameraStatus() {
  if (!navigator.mediaDevices?.getUserMedia) {
    setCamStatus('err', 'No soportado', 'Este navegador no soporta cámara (getUserMedia). Prueba Chrome/Edge.');
    return;
  }
  if (insecureContext()) {
    setCamStatus('warn', 'HTTPS requerido', 'Abre la app con candado (HTTPS) o en localhost; de lo contrario la cámara no funcionará.');
    return;
  }
  try {
    const anyCam = await hasVideoInput();
    if (!anyCam) {
      setCamStatus('err', 'Sin cámara detectada', 'Conecta una webcam o habilita la integrada y reintenta.');
    } else {
      setCamStatus('neutral', 'Permiso pendiente', 'Presiona “Permitir cámara” para iniciar.');
    }
  } catch {
    setCamStatus('neutral', 'Permiso pendiente', 'Presiona “Permitir cámara” para iniciar.');
  }

  // Actualiza si conectan/desconectan dispositivos
  navigator.mediaDevices?.addEventListener?.('devicechange', async () => {
    const anyCam = await hasVideoInput();
    if (!anyCam) setCamStatus('err', 'Sin cámara detectada', 'Conecta una webcam y reintenta.');
  });
})();

/* =========================
   Permitir / Reintentar cámara
   ========================= */
btnPermitir.onclick = async () => {
  if (insecureContext()) {
    setCamStatus('warn', 'HTTPS requerido', 'Abre la app en HTTPS o localhost, luego reintenta.');
    return;
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 } });
    cam.srcObject = stream;
    setCamStatus('ok', 'Listo', 'La cámara está activa. Puedes Iniciar la evaluación.');
  } catch (e) {
    if (e.name === 'NotAllowedError' || e.name === 'SecurityError') {
      setCamStatus('err', 'Permiso denegado', 'Haz clic en el candado de la barra de direcciones → Permisos → Cámara: Permitir. Luego presiona Reintentar.');
    } else if (e.name === 'NotFoundError' || e.name === 'OverconstrainedError') {
      setCamStatus('err', 'Sin cámara detectada', 'Conecta una webcam o verifica los drivers.');
    } else if (e.name === 'NotReadableError') {
      setCamStatus('warn', 'Cámara ocupada', 'Cierra otras apps que usen la cámara (Zoom/Meet/Teams) y presiona Reintentar.');
    } else {
      setCamStatus('err', 'Error de cámara', `Detalle: ${e.name}. Intenta Reintentar o recargar la página.`);
    }
  }
};

btnRetry.onclick = async () => {
  try {
    if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
  } catch {}
  setCamStatus('neutral', 'Permiso pendiente', 'Presiona “Permitir cámara” para iniciar.');
};

/* =========================
   TA-001: MediaPipe Face Landmarker (yaw + blink)
   ========================= */
let mpReady = false;
let faceLandmarker = null;

// Extrae yaw (grados) desde la matriz 4x4 de transformación facial
function yawFromMatrix(m) {
  // m es Float32Array(16), columna mayor
  const m00 = m[0], m10 = m[1], m20 = m[2];
  const yaw = Math.atan2(-m20, Math.hypot(m00, m10));
  return yaw * 180 / Math.PI;
}

// Promedio del blink de ambos ojos desde los blendshapes
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

  const blink = eyesClosedScore(out.faceBlendshapes?.[0]); // ~0..1
  // Etiqueta provisional por reglas simples
  let label = 'atento', score = 1 - blink;
  if (blink >= 0.6) { label = 'ojos_cerrados'; score = blink; }
  else if (Math.abs(yawDeg) >= 25) { label = 'cabeza_girada'; score = Math.min(1, Math.abs(yawDeg)/45); }

  return { yawDeg, blink, label, score };
}

/* =========================
   Loop de render + métricas
   ========================= */
let uiCounter = 0;
function loop() {
  if (!running) return;
  const t0 = metrics.onFrameStart();

  // Dibujo del frame
  ctx.drawImage(cam, 0, 0, canvas.width, canvas.height);

  // Inferencia MediaPipe cada ~2 frames (throttling suave)
  if (mpReady) {
    if (!loop._i) loop._i = 0;
    if ((loop._i++ % 2) === 0) {
      const pred = predictMP(cam);
      if (pred) {
        yawEl.textContent = pred.yawDeg.toFixed(1);
        blinkEl.textContent = pred.blink.toFixed(2);
        attn.textContent = pred.label; // estado provisional en UI
      }
    }
  }

  metrics.onFrameEnd(t0);

  // Actualiza UI ~cada 15 frames
  if (++uiCounter % 15 === 0) {
    const { fpsMed, latP95 } = metrics.read();
    fpsEl.textContent = Math.round(fpsMed);
    p95El.textContent = latP95.toFixed(1);
    tabState.textContent = document.visibilityState === 'visible' ? 'En pestaña' : 'Fuera de pestaña';
  }
  requestAnimationFrame(loop);
}

/* =========================
   Iniciar / Finalizar sesión
   ========================= */
btnStart.onclick = async () => {
  if (!stream) { alert('Primero permite la cámara.'); return; }
  // Carga el modelo una sola vez al iniciar
  await ensureMediaPipe();
  running = true;
  metrics.start();         // EN-001: inicia medición de rendimiento
  tabLogger.start();
  loop();
};

btnStop.onclick = () => {
  running = false;
  metrics.stop();                          // EN-001: detiene medición
  metrics.downloadCSV('rendimiento.csv');  // EN-001: descarga CSV de rendimiento
  tabLogger.stopAndDownloadCSV();          // CSV del logger de pestaña
};
