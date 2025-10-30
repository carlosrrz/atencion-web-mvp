// public/js/app.js
import { createMetrics }   from './metrics.js';
import { createTabLogger } from './tab-logger.js';

const $ = s => document.getElementById(s);

/* ===== DOM ===== */
const cam = $('cam'), canvas = $('canvas'), ctx = canvas.getContext('2d');
const btnPermitir = $('btn-permitir'), btnRetry = $('btn-reintentar');
const btnStart = $('btn-start'), btnStop = $('btn-stop');
const camStatus = $('cam-status'), camHelp = $('cam-help');
const sessionStatus = $('session-status'), sessionTime = $('session-time');

const metrics = createMetrics();
const tabLogger = createTabLogger({ offTabThresholdMs: 1500 });

/* ===== Estado ===== */
let stream=null, running=false, frameCount=0, sessionStart=0;

/* ===== Util ===== */
const insecureContext = () => !(location.protocol==='https:' || location.hostname==='localhost');
function setCamStatus(kind,msg,help=''){
  if(!camStatus) return;
  camStatus.className='pill';
  if(kind==='ok') camStatus.style.background='#dcfce7';
  else if(kind==='warn') camStatus.style.background='#fef9c3';
  else if(kind==='err') camStatus.style.background='#fee2e2';
  else camStatus.style.background='#eef';
  camStatus.textContent = msg;
  if (camHelp){
    if(help){ camHelp.textContent=help; camHelp.style.display='inline-block'; }
    else camHelp.style.display='none';
  }
}
function syncCanvas(){ const w=cam.videoWidth||640, h=cam.videoHeight||360; canvas.width=w; canvas.height=h; }
const fmt = ms => { const s=Math.floor(ms/1000); const mm=String(Math.floor(s/60)).padStart(2,'0'); const ss=String(s%60).padStart(2,'0'); return `${mm}:${ss}`; };

/* ===== Cámara ===== */
async function startCamera(){
  if (insecureContext()){ setCamStatus('warn','HTTPS requerido','Abre con candado (HTTPS) o localhost.'); return; }
  try{
    if (stream) stopStream();
    stream = await navigator.mediaDevices.getUserMedia({ video: { width:{ideal:1280}, height:{ideal:720}, facingMode:'user' }, audio:false });
    cam.srcObject = stream;
    await cam.play?.();
    if (cam.readyState>=2) syncCanvas();
    else cam.addEventListener('loadedmetadata', syncCanvas, { once:true });
    setCamStatus('ok', `Cámara lista (${cam.videoWidth||1280}×${cam.videoHeight||720})`, 'Puedes iniciar el monitoreo.');
  }catch(e){
    const n = e?.name || 'CameraError';
    if (n==='NotAllowedError' || n==='SecurityError') setCamStatus('err','Permiso denegado','Da permiso a la cámara (icono del candado).');
    else if (n==='NotFoundError' || n==='OverconstrainedError') setCamStatus('err','Sin cámara','Conecta una webcam o revisa drivers.');
    else if (n==='NotReadableError') setCamStatus('warn','Cámara ocupada','Cierra Zoom/Meet/Teams y reintenta.');
    else setCamStatus('err','Error de cámara',`Detalle: ${n}`);
  }
}
function stopStream(){ try{ stream?.getTracks()?.forEach(t=>t.stop()); }catch{} stream=null; }

/* ===== Loop simple (pinta video + tiempo) ===== */
function loop(){
  if (!running) return;
  if (cam.readyState >= 2){
    try{ ctx.drawImage(cam,0,0,canvas.width,canvas.height); }catch{}
  }
  // métricas/tiempo
  try{ const m0=metrics.onFrameStart?.(); metrics.onFrameEnd?.(m0??performance.now()); }catch{}
  const ms = performance.now() - sessionStart;
  if (sessionTime) sessionTime.textContent = fmt(ms);
  frameCount++;
  requestAnimationFrame(loop);
}

/* ===== Botones ===== */
btnPermitir?.addEventListener('click', startCamera);
btnRetry?.addEventListener('click', ()=>{ stopStream(); setCamStatus('neutral','Permiso pendiente','Presiona “Permitir cámara”.'); });

btnStart?.addEventListener('click', ()=>{
  if (!stream){ alert('Primero permite la cámara.'); return; }
  running=true; frameCount=0; sessionStart=performance.now();
  sessionStatus && (sessionStatus.textContent='Monitoreando');
  metrics.start(); tabLogger.start?.();
  loop();
});

btnStop?.addEventListener('click', ()=>{
  running=false; metrics.stop();
  sessionStatus && (sessionStatus.textContent='Detenida');

  // Guarda un intento MUY simple (duración + alumno) para que el encargado lo vea
  const student = {
    name: localStorage.getItem('st_name') || '',
    id:   localStorage.getItem('st_id')   || ''
  };
  const attempt = {
    student,
    session: { duration_ms: Math.round(performance.now() - sessionStart) },
    summary: { note: 'Monitoreo básico sin análisis (MVP)' }
  };
  const arr = JSON.parse(localStorage.getItem('exam_attempts')||'[]'); arr.push(attempt);
  localStorage.setItem('exam_attempts', JSON.stringify(arr));
  alert('Monitoreo finalizado y guardado para el encargado.');
});

/* ===== Datos estudiante: guardado rápido ===== */
document.getElementById('btn-save-data')?.addEventListener('click', ()=>{
  localStorage.setItem('st_name', document.getElementById('st-name')?.value||'');
  localStorage.setItem('st_id',   document.getElementById('st-id')?.value||'');
  const tag = document.getElementById('save-msg'); if(tag){ tag.style.display='inline-block'; setTimeout(()=>tag.style.display='none',1500); }
});
window.addEventListener('DOMContentLoaded', ()=>{
  const n=localStorage.getItem('st_name'); if(n) document.getElementById('st-name').value=n;
  const i=localStorage.getItem('st_id');   if(i) document.getElementById('st-id').value=i;
  // chequeo rápido para que veas si el wiring está correcto
  console.debug('[app] wiring',
    !!btnPermitir, !!btnStart, !!btnStop, !!cam, !!canvas
  );
});
