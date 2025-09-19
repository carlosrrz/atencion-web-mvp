import { createMetrics } from './metrics.js';
import { createTabLogger } from './tab-logger.js';

const cam = document.getElementById('cam');
const canvas = document.getElementById('canvas');
const btnPermitir = document.getElementById('btn-permitir');
const btnStart = document.getElementById('btn-start');
const btnStop = document.getElementById('btn-stop');
const tabState = document.getElementById('tab-state');
const attn = document.getElementById('attn-state');
const fpsEl = document.getElementById('fps'); const p95El = document.getElementById('p95');
const ctx = canvas.getContext('2d');
const metrics = createMetrics(); const tabLogger = createTabLogger();
let stream = null; let running = false;

btnPermitir.onclick = async () => {
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 } });
    cam.srcObject = stream;
  } catch (e) { alert('No se pudo acceder a la cámara. Revisa permisos y HTTPS.'); }
};

function loop() {
  if (!running) return;
  const t0 = metrics.onFrameStart();
  ctx.drawImage(cam, 0, 0, canvas.width, canvas.height);
  // TODO: aquí irá la inferencia del modelo TF.js y actualización de "attn"
  metrics.onFrameEnd(t0);
  if (performance.now() % 10 < 1) {
    const { fpsMed, latP95 } = metrics.read();
    fpsEl.textContent = fpsMed; p95El.textContent = latP95;
    tabState.textContent = document.visibilityState === 'visible' ? 'En pestaña' : 'Fuera de pestaña';
  }
  requestAnimationFrame(loop);
}

btnStart.onclick = () => { if (!stream) { alert('Primero permite la cámara.'); return; } running = true; tabLogger.start(); loop(); };
btnStop.onclick  = () => { running = false; tabLogger.stopAndDownloadCSV(); };
