// app.js — MVP + proctoring ligero (robusto con imports dinámicos)
import { createMetrics } from './metrics.js';
import { createTabLogger } from './tab-logger.js';
import { FilesetResolver, FaceLandmarker } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3";

/* ===== Carga OPCIONAL de módulos (no rompe si faltan) ===== */
let poseLogger = { start(){}, stop(){}, log(){}, downloadCSV(){}, downloadSummaryJSON(){} };
let evidence   = { snapshot(){}, list(){ return []; }, downloadJSON(){}, clear(){} };

let _evidenceLoaded = false;

(async () => {
  try {
    const { createPoseLogger } = await import('./pose-logger.js');
    poseLogger = createPoseLogger({ sampleMs: 200 });
  } catch (e) { console.warn('[opc] pose-logger no cargado:', e.message); }

  try {
    const { createEvidence } = await import('./evidence.js');
    evidence = createEvidence();
    _evidenceLoaded = true;
  } catch (e) { console.warn('[opc] evidence no cargado:', e.message); }
})();

/* ===================== DOM ===================== */
const cam    = document.getElementById('cam');
const canvas = document.getElementById('canvas');
const ctx    = canvas.getContext('2d');

const btnPermitir = document.getElementById('btn-permitir');
const btnRetry    = document.getElementById('btn-reintentar');
const btnStart    = document.getElementById('btn-start');
const btnStop     = document.getElementById('btn-stop');
const btnEvid     = document.getElementById('btn-evidencias');
const btnEvidClose= document.getElementById('btn-evid-close');
const btnEvidDl   = document.getElementById('btn-evid-download');

const camStatus = document.getElementById('cam-status');
const camHelp   = document.getElementById('cam-help');

const sessionStatus = document.getElementById('session-status');
const sessionTime   = document.getElementById('session-time');

const tabState  = document.getElementById('tab-state');
const attnEl    = document.getElementById('attn-state');
const lipsEl    = document.getElementById('lips-state'); // opcional
const offCntEl  = document.getElementById('offtab-count');
const offTimeEl = document.getElementById('offtab-time');

const fpsEl   = document.getElementById('fps');
const p95El   = document.getElementById('p95');
const fpsPill = document.getElementById('fps-pill');
const p95Pill = document.getElementById('p95-pill');
const perfAll = document.getElementById('perf-overall');

/* ===== Tabs (si existen) ===== */
const tabButtons = Array.from(document.querySelectorAll('.tab'));
const sections = {
  lectura: document.getElementById('lectura'),
  video:   document.getElementById('video'),
  examen:  document.getElementById('examen') || document.getElementById('exam-root'),
};

/* ============ Constantes de detección ============ */
const DETECT_EVERY   = 4;

const ENTER_AR       = 0.62, EXIT_AR = 0.70;
const ENTER_OFFX     = 0.22, EXIT_OFFX = 0.18;
const SCORE_ENTER    = 12,   SCORE_EXIT = 6;
const MIN_FACE_AREA  = 0.05;

const GAZE_V_STRICT  = 0.40, GAZE_H_STRICT = 0.50;
const MOUTH_ENTER    = 0.38, MOUTH_EXIT    = 0.30;

const OFFTAB_EP_MS   = 1500;

/* ===================== Estado ===================== */
let stream = null, running = false, camRequested = false;
let frameCount = 0, sessionStart = 0;
let landmarker = null, lastVideoTime = -1;

let awayScore = 0, isLookAway = false;
let mouthTalk = false, occlScore = 0, occluded = false;

let offTabStart = null, offTabEpisodes = 0, offTabAccumMs = 0;

/* ============ Métricas / Loggers ============ */
const metrics    = createMetrics();
const tabLogger  = createTabLogger();

/* ==================== Utils/UI ==================== */
const insecureContext = () => !(location.protocol === 'https:' || location.hostname === 'localhost');
const isInTab = () => document.visibilityState === 'visible' && document.hasFocus();

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

/* ===== Semáforo rendimiento ===== */
const PERF={ fps:{green:24,amber:18}, p95:{green:200,amber:350} };
const levelFPS=v=>v>=PERF.fps.green?'ok':v>=PERF.fps.amber?'warn':'err';
const levelP95=v=>v<=PERF.p95.green?'ok':v<=PERF.p95.amber?'warn':'err';
const worst=(a,b)=>({ok:0,warn:1,err:2}[a] >= {ok:0,warn:1,err:2}[b] ? a : b);
function setPill(el, level, label){ if(!el) return; el.classList.remove('pill-neutral','pill-ok','pill-warn','pill-err'); el.classList.add('pill',`pill-${level}`); el.textContent=label; }
let lastFrameTs=0; const fpsS=[]; const procS=[]; const MAXS=120;
const push=(a,v)=>{a.push(v); if(a.length>MAXS)a.shift();};
const median=a=>{ if(!a.length) return 0; const s=[...a].sort((x,y)=>x-y); const m=Math.floor(s.length/2); return s.length%2?s[m]:(s[m-1]+s[m])/2; };
const perc=(a,p=.95)=>{ if(!a.length) return 0; const s=[...a].sort((x,y)=>x-y); const i=Math.min(s.length-1, Math.floor(p*(s.length-1))); return s[i]; };
function updatePerfUI(){
  const fpsMed=Math.round(median(fpsS));
  const p95=Math.round(perc(procS,.95)*10)/10;
  fpsEl&&(fpsEl.textContent=fpsMed); p95El&&(p95El.textContent=p95);
  const lf=levelFPS(fpsMed), lp=levelP95(p95);
  setPill(fpsPill,lf,lf==='ok'?'🟢':lf==='warn'?'🟠':'🔴');
  setPill(p95Pill,lp,lp==='ok'?'🟢':lp==='warn'?'🟠':'🔴');
  setPill(perfAll,worst(lf,lp), worst(lf,lp)==='ok'?'🟢 Óptimo': worst(lf,lp)==='warn'?'🟠 Atención':'🔴 Riesgo');
}

/* ==================== Cámara ==================== */
async function startCamera() {
  if (insecureContext()) { setCamStatus('warn','HTTPS requerido','Abre la app en HTTPS o localhost.'); return; }
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 } });
    cam.srcObject = stream; await cam.play?.();
    if (cam.readyState >= 2) syncCanvasToVideo();
    else cam.addEventListener('loadedmetadata', syncCanvasToVideo, { once: true });
    setCamStatus('ok', `Listo (${cam.videoWidth || 1280}x${cam.videoHeight || 720})`, 'La cámara está activa. Puedes Iniciar.');

    // Cargar FaceLandmarker
    (async () => {
      try {
        if (!landmarker) {
          const wasmBase = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm";
          const fileset = await FilesetResolver.forVisionTasks(wasmBase);
          landmarker = await FaceLandmarker.createFromOptions(fileset, {
            baseOptions: { modelAssetPath:
              "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task" },
            runningMode: "VIDEO", numFaces: 1, outputFaceBlendshapes: true,
          });
          console.log('[landmarker] listo');
        }
      } catch (err) { console.warn("FaceLandmarker no disponible:", err); }
    })();

  } catch (e) {
    const n = e?.name || 'CameraError';
    if (n === 'NotAllowedError' || n === 'SecurityError')
      setCamStatus('err','Permiso denegado','Candado → Cámara: Permitir.');
    else if (n === 'NotFoundError' || n === 'OverconstrainedError')
      setCamStatus('err','Sin cámara','Conecta una webcam o verifica drivers.');
    else if (n === 'NotReadableError')
      setCamStatus('warn','Cámara ocupada','Cierra Zoom/Meet/Teams y reintenta.');
    else setCamStatus('err','Error de cámara',`Detalle: ${n}`);
  }
}

/* ==================== Loop ==================== */
function loop(){
  if (!running) return;
  if (cam.readyState < 2){ requestAnimationFrame(loop); return; }

  const t0 = performance.now();
  ctx.drawImage(cam,0,0,canvas.width,canvas.height);
  const t1 = performance.now();

  push(procS, t1-t0);
  if (lastFrameTs) push(fpsS, 1000/(t1-lastFrameTs));
  lastFrameTs = t1;

  try{ const m0=metrics.onFrameStart?.(); metrics.onFrameEnd?.(m0??t0); }catch{}

  frameCount++;
  if (frameCount % 10 === 0){
    updatePerfUI();
    const ms = performance.now() - sessionStart;
    sessionTime && (sessionTime.textContent = fmtTime(ms));
    tabState && (tabState.textContent = isInTab() ? 'En pestaña' : 'Fuera de pestaña');
  }

  if (landmarker && frameCount % DETECT_EVERY === 0) {
    const ts = performance.now();
    if (cam.currentTime !== lastVideoTime) {
      lastVideoTime = cam.currentTime;
      const out = landmarker.detectForVideo(cam, ts);
      const lm  = out?.faceLandmarks?.[0];

      let awayNow = false, backNow = false;
      let yawProxy=0, pitchProxy=0, occl=0, gazeH=0, gazeV=0, mouth=0;

      if (!lm) {
        awayNow = true; occl = 1; occlScore = Math.min(10, occlScore + 1);
      } else {
        let minx=1,maxx=0,miny=1,maxy=0;
        for (const p of lm) { if(p.x<minx)minx=p.x; if(p.x>maxx)maxx=p.x; if(p.y<miny)miny=p.y; if(p.y>maxy)maxy=p.y; }
        const w = maxx-minx, h = maxy-miny, area = w*h;
        const ar = w / (h + 1e-6);
        const cx = (minx+maxx)/2, cy = (miny+maxy)/2;
        const nose = lm[1] || lm[4] || lm[0];
        const offX = Math.abs((nose.x - cx) / (w + 1e-6));
        const offY = Math.abs((nose.y - cy) / (h + 1e-6));

        yawProxy   = Math.max(-1, Math.min(1, (nose.x - cx) / (w + 1e-6)));
        pitchProxy = Math.max(-1, Math.min(1, (nose.y - cy) / (h + 1e-6)));

        occl = area < MIN_FACE_AREA ? 1 : 0;
        occlScore = Math.max(0, occl ? occlScore + 1 : occlScore - 1);
        const occlStable = occlScore >= 6;

        if (area >= MIN_FACE_AREA) {
          awayNow = (ar < ENTER_AR) || (offX > ENTER_OFFX) || (offY > 0.30);
          backNow = (ar > EXIT_AR)  && (offX < EXIT_OFFX) && (offY < 0.24);
        }

        const bs = out?.faceBlendshapes?.[0]?.categories || [];
        const S  = Object.fromEntries(bs.map(c=>[c.categoryName, c.score]));
        const up   = ((S.eyeLookUpLeft||0)+(S.eyeLookUpRight||0))/2;
        const down = ((S.eyeLookDownLeft||0)+(S.eyeLookDownRight||0))/2;
        const outL = (S.eyeLookOutLeft||0), outR = (S.eyeLookOutRight||0);
        const inL  = (S.eyeLookInLeft||0),  inR  = (S.eyeLookInRight||0);
        gazeH = (outR + inL) - (outL + inR);
        gazeV = (up) - (down);

        const mouthAux = (0.6*(S.jawOpen||0) + 0.4*(
          (S.mouthUpperUpLeft||0)+(S.mouthUpperUpRight||0)+
          (S.mouthLowerDownLeft||0)+(S.mouthLowerDownRight||0)
        )/4);
        if (!mouthTalk && mouthAux >= MOUTH_ENTER) mouthTalk = true;
        if (mouthTalk && mouthAux <= MOUTH_EXIT)  mouthTalk = false;
        mouth = mouthAux;

        if (awayNow) awayScore = Math.min(SCORE_ENTER, awayScore + 1);
        else if (backNow) awayScore = Math.max(0, awayScore - 2);
        else awayScore = Math.max(0, awayScore - 1);

        if (!isLookAway && awayScore >= SCORE_ENTER) {
          isLookAway = true;
          evidence.snapshot('alert/lookAway', 'Mirada desviada sostenida', cam);
        }
        if (isLookAway && awayScore <= SCORE_EXIT) isLookAway = false;

        if (!occluded && occlStable) { occluded = true; evidence.snapshot('alert/occlusion', 'Rostro cubierto/fuera', cam); }
        if (occluded && !occlStable) occluded = false;

        if (mouthTalk && lipsEl && lipsEl.dataset._last!=='talk') {
          evidence.snapshot('alert/speech', 'Posible habla', cam);
          lipsEl.dataset._last = 'talk';
        } else if (lipsEl && !mouthTalk) { lipsEl.dataset._last = 'idle'; }
      }

      // UI atención/labios
      const nowVisible = isInTab();
      let attnState = 'atento';
      if (!nowVisible) {
        const hiddenFor = offTabStart ? (performance.now() - offTabStart) : 0;
        attnState = hiddenFor >= 2000 ? 'distracción (fuera de pestaña)' : 'intermitente';
      } else if (isLookAway) { attnState = 'mirada desviada'; }
      attnEl && (attnEl.textContent = attnState);
      lipsEl && (lipsEl.textContent = mouthTalk ? 'posible habla' : '—');

      // registro de pose (si el módulo está)
      poseLogger.log({ yaw: yawProxy, pitch: pitchProxy, mouth, occl,
                       gazeH, gazeV, lookAway: isLookAway, inTab: nowVisible });
    }
  }

  const accum = offTabAccumMs + (offTabStart ? (performance.now() - offTabStart) : 0);
  offTimeEl && (offTimeEl.textContent = fmtTime(accum));
  offCntEl  && (offCntEl.textContent  = String(offTabEpisodes));

  requestAnimationFrame(loop);
}

/* ===== Off-tab acumulado (UI) ===== */
function handleTabStateChange(){
  if (!running) return;
  const now = performance.now(), inTab = isInTab();
  if (!inTab) {
    if (offTabStart == null) offTabStart = now;
  } else if (offTabStart != null) {
    const dur = now - offTabStart;
    if (dur >= OFFTAB_EP_MS) offTabEpisodes += 1;
    offTabAccumMs += dur;
    offTabStart = null;
  }
}
document.addEventListener('visibilitychange', handleTabStateChange);
window.addEventListener('focus', handleTabStateChange);
window.addEventListener('blur', handleTabStateChange);

/* ===== TabLogger → snapshot evidencia ===== */
tabLogger.setOnAlert?.((type) => {
  if (type === 'off_tab') evidence.snapshot('alert/off_tab', 'Fuera de pestaña ≥ umbral', cam);
});

/* ==================== Evidencias (modal) ==================== */
function openEvidenceModal(){
  const grid = document.getElementById('evidence-grid');
  const mb   = document.getElementById('evidence-backdrop');
  const mm   = document.getElementById('evidence-modal');
  if (!grid || !mb || !mm) { alert('Modal de evidencias no está en el HTML.'); return; }
  grid.innerHTML = '';

  const items = evidence.list();
  if (!_evidenceLoaded) {
    grid.innerHTML = `<div class="help">El módulo de evidencias no se cargó. Verifica que exista <code>src/evidence.js</code>.</div>`;
  } else if (!items.length) {
    grid.innerHTML = `<div class="help">Aún no hay evidencias. Gira la cabeza, habla o sal de la pestaña para generar alertas.</div>`;
  } else {
    for (const it of items) {
      const box = document.createElement('div');
      box.style.border = '1px solid #e5e7eb';
      box.style.borderRadius = '10px';
      box.style.padding = '6px';
      box.innerHTML = `
        <div class="pill pill-warn" style="margin-bottom:6px">${it.kind}</div>
        <img src="${it.data}" alt="${it.kind}" style="width:100%;border-radius:8px;display:block"/>
        <div class="help">${new Date(it.t).toLocaleTimeString()} — ${it.note || ''}</div>
      `;
      grid.appendChild(box);
    }
  }
  mb.classList.remove('hidden'); mm.classList.remove('hidden');
}
btnEvid?.addEventListener('click', openEvidenceModal);
btnEvidClose?.addEventListener('click', ()=>{
  document.getElementById('evidence-backdrop')?.classList.add('hidden');
  document.getElementById('evidence-modal')?.classList.add('hidden');
});
btnEvidDl?.addEventListener('click', ()=> evidence.downloadJSON?.('evidencias.json') );

/* ==================== Handlers UI ==================== */
btnPermitir?.addEventListener('click', async ()=>{
  camRequested = true;
  await startCamera();
});
btnRetry?.addEventListener('click', ()=>{ releaseStream(); setCamStatus('neutral','Permiso pendiente','Presiona “Permitir cámara”.'); });

btnStart?.addEventListener('click', ()=>{
  if (!stream){ alert('Primero permite la cámara.'); return; }
  running = true;
  frameCount = 0; sessionStart = performance.now();
  lastFrameTs = 0; fpsS.length=0; procS.length=0;

  offTabStart = isInTab() ? null : performance.now();
  offTabEpisodes=0; offTabAccumMs=0;
  awayScore=0; isLookAway=false; mouthTalk=false; occluded=false; occlScore=0;

  sessionStatus && (sessionStatus.textContent = 'Monitoreando');
  tabLogger.start?.(); poseLogger.start(); evidence.clear();
  loop();
});

btnStop?.addEventListener('click', ()=>{
  if (offTabStart != null){
    const now = performance.now(), dur = now - offTabStart;
    if (dur >= OFFTAB_EP_MS) offTabEpisodes += 1;
    offTabAccumMs += dur; offTabStart = null;
  }
  running = false;
  sessionStatus && (sessionStatus.textContent = 'Detenida');
  tabLogger.stopAndDownloadCSV?.();
  poseLogger.stop(); poseLogger.downloadCSV?.('poses.csv'); poseLogger.downloadSummaryJSON?.('poses_summary.json');
});

/* ===== Re-apertura / dispositivos ===== */
document.addEventListener('visibilitychange', async ()=>{
  if (document.visibilityState==='visible' && !stream && camRequested && !insecureContext()){
    await startCamera();
  }
});
navigator.mediaDevices?.addEventListener?.('devicechange', async ()=>{
  if (!stream && camRequested && !insecureContext()) await startCamera();
});

/* ==================== Tabs ==================== */
function showSection(key){
  for (const k of Object.keys(sections)){ const el=sections[k]; if(!el) continue; (k===key)?el.classList.remove('hidden'):el.classList.add('hidden'); }
  tabButtons.forEach(b => b.classList.toggle('active', b.dataset.t===key));
}
tabButtons.forEach(btn=>btn.addEventListener('click', ()=>{ const k=btn.dataset.t; if(k) showSection(k); }));
showSection(tabButtons.find(b=>b.classList.contains('active'))?.dataset.t || 'lectura');

/* ==================== Init ==================== */
(function init(){
  if (!navigator.mediaDevices?.getUserMedia){ setCamStatus('err','No soportado','Usa Chrome/Edge.'); return; }
  if (insecureContext()){ setCamStatus('warn','HTTPS requerido','Abre con candado (HTTPS) o localhost.'); return; }
  setCamStatus('neutral','Permiso pendiente','Presiona “Permitir cámara”.');
  sessionStatus && (sessionStatus.textContent = 'Detenida');
  sessionTime && (sessionTime.textContent = '00:00');
  fpsEl&&(fpsEl.textContent='0'); p95El&&(p95El.textContent='0.0');
  tabState&&(tabState.textContent='—'); attnEl&&(attnEl.textContent='—'); lipsEl&&(lipsEl.textContent='—');
  offCntEl&&(offCntEl.textContent='0'); offTimeEl&&(offTimeEl.textContent='00:00');
})();
