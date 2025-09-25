// app.js
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

// ⬇️ NUEVO: elementos de HU-002
const camStatus = document.getElementById('cam-status');
const camHelp   = document.getElementById('cam-help');
const btnRetry  = document.getElementById('btn-reintentar');

const ctx = canvas.getContext('2d');
const metrics = createMetrics();
const tabLogger = createTabLogger();

let stream = null;
let running = false;

/* =========================
   Utilidades HU-002 (estado)
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
   Loop de render + métricas
   ========================= */
function loop() {
  if (!running) return;
  const t0 = metrics.onFrameStart();

  ctx.drawImage(cam, 0, 0, canvas.width, canvas.height);
  // TODO: aquí irá la inferencia del modelo TF.js y actualización de "attn"

  metrics.onFrameEnd(t0);

  // Actualiza UI cada ~10 frames
  if (performance.now() % 10 < 1) {
    const { fpsMed, latP95 } = metrics.read();
    fpsEl.textContent = fpsMed;
    p95El.textContent = latP95;
    tabState.textContent = document.visibilityState === 'visible' ? 'En pestaña' : 'Fuera de pestaña';
  }
  requestAnimationFrame(loop);
}

/* =========================
   Iniciar / Finalizar sesión
   ========================= */
btnStart.onclick = () => {
  if (!stream) { alert('Primero permite la cámara.'); return; }
  running = true;
  tabLogger.start();
  loop();
};

btnStop.onclick = () => {
  running = false;
  tabLogger.stopAndDownloadCSV();
};