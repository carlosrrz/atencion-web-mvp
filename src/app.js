// app.js (hard reset estable)
import { createMetrics } from './metrics.js';
import { createTabLogger } from './tab-logger.js';

// ======= Elementos DOM =======
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
const attnEl        = document.getElementById('attn-state');

const fpsEl = document.getElementById('fps');
const p95El = document.getElementById('p95');
const fpsPill = document.getElementById('fps-pill');
const p95Pill = document.getElementById('p95-pill');
const overallPill = document.getElementById('perf-overall');

// Modal de consentimiento (opcional: si no existe, no rompe)
const consentBackdrop = document.getElementById('consent-backdrop');
const consentModal    = document.getElementById('consent-modal');
const consentAccept   = document.getElementById('consent-accept');
const consentCancel   = document.getElementById('consent-cancel');
const consentCheck    = document.getElementById('consent-check');
document.getElementById('open-privacy')?.addEventListener('click', (e) => { e.preventDefault(); showConsent(); });

// ======= Estado =======
let stream = null;
let running = false;
let camRequested = false;
let frameCount = 0;
let sessionStart = 0;

const metrics = createMetrics();
const tabLogger = createTabLogger();

// ======= Utilidades de consentimiento =======
const CONSENT_KEY = 'mvp.consent.v1';
function hasConsent() { try { return !!localStorage.getItem(CONSENT_KEY); } catch { return false; } }
function setConsent() { try { localStorage.setItem(CONSENT_KEY, JSON.stringify({ v:1, ts: Date.now() })); } catch {} }
function showConsent() {
  if (!consentModal || !consentBackdrop) { alert('Para usar la cámara debes aceptar el consentimiento.'); return; }
  if (consentCheck) { consentCheck.checked = false; consentAccept && (consentAccept.disabled = true); }
  consentBackdrop.classList.remove('hidden'); consentModal.classList.remove('hidden');
}
function hideConsent() {
  if (!consentModal || !consentBackdrop) return;
  consentBackdrop.classList.add('hidden'); consentModal.classList.add('hidden');
}
consentCheck?.addEventListener('change', () => { if (consentAccept) consentAccept.disabled = !consentCheck.checked; });
consentCancel?.addEventListener('click', hideConsent);
consentAccept?.addEventListener('click', () => { setConsent(); hideConsent(); });

// ======= Camara / UI helpers =======
function insecureContext() { return !(location.protocol === 'https:' || location.hostname === 'localhost'); }
function setCamStatus(kind, msg, help='') {
  if (!camStatus) return;
  camStatus.className = 'pill ' + (
    kind === 'ok' ? 'pill-ok' : kind === 'warn' ? 'pill-warn' : kind === 'err' ? 'pill-err' : 'pill-neutral'
  );
  camStatus.textContent = msg;
  if (camHelp) {
    if (help) { camHelp.textContent = help; camHelp.classList.remove('hidden'); }
    else { camHelp.classList.add('hidden'); }
  }
}
function releaseStream() {
  try { stream?.getTracks()?.forEach(t => t.stop()); } catch {}
  stream = null;
}

// Ajusta el canvas a tamaño real del video cuando haya metadata
function syncCanvasToVideo() {
  const w = cam.videoWidth || 640;
  const h = cam.videoHeight || 360;
  canvas.width = w; canvas.height = h;
}

// ======= Semáforo (RN-001) =======
const PERF_THRESH = { fps: { green: 24, amber: 18 }, p95: { green: 200, amber: 350 } };
function levelForFPS(fps) { if (fps >= PERF_THRESH.fps.green) return 'ok'; if (fps >= PERF_THRESH.fps.amber) return 'warn'; return 'err'; }
function levelForP95(ms)  { if (ms  <= PERF_THRESH.p95.green) return 'ok'; if (ms  <= PERF_THRESH.p95.amber) return 'warn'; return 'err'; }
function setPill(el, level, label) {
  if (!el) return;
  el.classList.remove('pill-neutral','pill-ok','pill-warn','pill-err');
  el.classList.add('pill', `pill-${level}`);
  el.textContent = label;
}
function worst(a,b){ const r={ok:0,warn:1,err:2}; return (r[a]>=r[b])?a:b; }
function updatePerfIndicators(fpsMed, latP95) {
  const lf = levelForFPS(fpsMed);
  const lp = levelForP95(latP95);
  setPill(fpsPill, lf, lf==='ok'?'🟢':lf==='warn'?'🟠':'🔴');
  setPill(p95Pill, lp, lp==='ok'?'🟢':lp==='warn'?'🟠':'🔴');
  const ov = worst(lf, lp);
  setPill(overallPill, ov, ov==='ok'?'🟢 Óptimo':ov==='warn'?'🟠 Atención':'🔴 Riesgo');
}

// ======= Cámara: iniciar =======
async function startCamera() {
  if (insecureContext()) {
    setCamStatus('warn', 'HTTPS requerido', 'Abre la app en HTTPS o localhost y reintenta.');
    return;
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 } });
    cam.srcObject = stream;
    await cam.play?.();

    if (cam.readyState >= 2) syncCanvasToVideo();
    else cam.addEventListener('loadedmetadata', syncCanvasToVideo, { once: true });

    setCamStatus('ok', `Listo (${cam.videoWidth||1280}x${cam.videoHeight||720})`, 'La cámara está activa. Puedes Iniciar la evaluación.');
  } catch (e) {
    const name = e?.name || 'CameraError';
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      setCamStatus('err', 'Permiso denegado', 'Haz clic en el candado del navegador → Cámara: Permitir.');
    } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
      setCamStatus('err', 'Sin cámara', 'Conecta una webcam o verifica drivers.');
    } else if (name === 'NotReadableError') {
      setCamStatus('warn', 'Cámara ocupada', 'Cierra Zoom/Meet/Teams y reintenta.');
    } else {
      setCamStatus('err', 'Error de cámara', `Detalle: ${name}`);
    }
  }
}

// ======= Bucle principal =======
function loop() {
  if (!running) return;

  if (cam.readyState < 2) { requestAnimationFrame(loop); return; }

  const t0 = metrics.onFrameStart();
  ctx.drawImage(cam, 0, 0, canvas.width, canvas.height);
  metrics.onFrameEnd(t0);

  frameCount++;
  if (frameCount % 10 === 0) {
    const { fpsMed, latP95 } = metrics.read();
    if (fpsEl) fpsEl.textContent = fpsMed;
    if (p95El) p95El.textContent = latP95;
    updatePerfIndicators(fpsMed, latP95);

    // tiempo de sesión
    const ms = performance.now() - sessionStart;
    const s  = Math.floor(ms / 1000);
    const mm = String(Math.floor(s / 60)).padStart(2, '0');
    const ss = String(s % 60).padStart(2, '0');
    sessionTime && (sessionTime.textContent = `${mm}:${ss}`);

    // pestaña
    tabState && (tabState.textContent = document.visibilityState === 'visible' ? 'En pestaña' : 'Fuera de pestaña');
  }

  requestAnimationFrame(loop);
}

// ======= Handlers UI =======
btnPermitir?.addEventListener('click', async () => {
  if (!hasConsent()) { showConsent(); return; }
  camRequested = true;
  await startCamera();
});

btnRetry?.addEventListener('click', () => {
  releaseStream();
  setCamStatus('neutral', 'Permiso pendiente', 'Presiona “Permitir cámara” para iniciar.');
});

btnStart?.addEventListener('click', () => {
  if (!hasConsent()) { showConsent(); return; }
  if (!stream) { alert('Primero permite la cámara.'); return; }
  running = true;
  frameCount = 0;
  sessionStart = performance.now();
  sessionStatus && (sessionStatus.textContent = 'Monitoreando');
  tabLogger.start?.();
  loop();
});

btnStop?.addEventListener('click', () => {
  running = false;
  sessionStatus && (sessionStatus.textContent = 'Detenida');
  tabLogger.stopAndDownloadCSV?.();
});

// Reconexión suave al volver a la pestaña / cambio de dispositivos (solo si el usuario pidió cámara)
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible' && !stream && camRequested && hasConsent()) {
    await startCamera();
  }
});
navigator.mediaDevices?.addEventListener?.('devicechange', async () => {
  if (!stream && camRequested && hasConsent()) await startCamera();
});

// Estado inicial
(function init() {
  if (!navigator.mediaDevices?.getUserMedia) {
    setCamStatus('err', 'No soportado', 'Este navegador no soporta cámara (getUserMedia). Usa Chrome/Edge.');
    return;
  }
  if (insecureContext()) {
    setCamStatus('warn', 'HTTPS requerido', 'Abre la app con candado (HTTPS) o en localhost.');
    return;
  }
  setCamStatus('neutral', 'Permiso pendiente', 'Presiona “Permitir cámara” para iniciar.');
  sessionStatus && (sessionStatus.textContent = 'Detenida');
  sessionTime && (sessionTime.textContent = '00:00');
  fpsEl && (fpsEl.textContent = '0');
  p95El && (p95El.textContent = '0.0');
})();
