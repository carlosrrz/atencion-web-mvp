// app.js — MVP + proctoring ligero con evidencias integradas y UI mejorada
import { createMetrics } from './metrics.js';
import { createTabLogger } from './tab-logger.js';
import { FilesetResolver, FaceLandmarker } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3";

/* ============== Helpers integrados ============== */
// Evidencias (galería de snapshots)
function createEvidence(){
  const items = []; // {t, kind, note, data}
  function snapshot(kind, note, sourceEl){
    try{
      // si tenemos un canvas principal con el frame ya dibujado es más rápido
      let dataUrl = null;
      if (sourceEl && sourceEl.tagName === 'CANVAS'){
        dataUrl = sourceEl.toDataURL('image/jpeg', 0.9);
      } else {
        const video = sourceEl || document.getElementById('cam');
        const off = document.createElement('canvas');
        off.width = 320; off.height = 180;
        const ox = off.getContext('2d');
        ox.drawImage(video, 0,0, off.width, off.height);
        dataUrl = off.toDataURL('image/jpeg', 0.9);
      }
      items.push({ t: Date.now(), kind, note, data: dataUrl });
      if (items.length > 60) items.shift(); // límite razonable
    }catch(e){ console.warn('snapshot error', e); }
  }
  function list(){ return items.slice(); }
  function clear(){ items.length = 0; }
  function downloadJSON(filename='evidencias.json'){
    const blob = new Blob([JSON.stringify(items,null,2)], {type:'application/json'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = filename; a.click();
    URL.revokeObjectURL(a.href);
  }
  return { snapshot, list, clear, downloadJSON };
}

// Logger simple de “poses”
function createPoseLogger({sampleMs=200}={}){
  const rows = []; // t, yaw, pitch, mouth, occl, gazeH, gazeV, lookAway, inTab
  let last = 0, running=false;
  function start(){ running=true; last=0; rows.length=0; }
  function stop(){ running=false; }
  function log(obj){
    if(!running) return;
    const now = performance.now();
    if (now - last < sampleMs) return;
    last = now;
    rows.push({ t: Math.round(now), ...obj });
    if (rows.length > 6000) rows.shift();
  }
  function downloadCSV(filename='poses.csv'){
    if(!rows.length) return;
    const header = ['t_ms','yaw','pitch','mouth','occl','gazeH','gazeV','lookAway','inTab'].join(',');
    const body = rows.map(r => [r.t,r.yaw,r.pitch, r.mouth?.toFixed?.(3)??0, r.occl, r.gazeH?.toFixed?.(3)??0, r.gazeV?.toFixed?.(3)??0, r.lookAway?1:0, r.inTab?1:0].join(',')).join('\n');
    const blob = new Blob([header+'\n'+body], {type:'text/csv'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = filename; a.click();
    URL.revokeObjectURL(a.href);
  }
  function downloadSummaryJSON(filename='poses_summary.json'){
    const total = rows.length;
    const off = rows.filter(r=>!r.inTab).length;
    const away = rows.filter(r=>r.lookAway).length;
    const obj = { samples: total, off_samples: off, lookaway_samples: away };
    const blob = new Blob([JSON.stringify(obj,null,2)],{type:'application/json'});
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; a.click();
    URL.revokeObjectURL(a.href);
  }
  return { start, stop, log, downloadCSV, downloadSummaryJSON };
}

/* ============== DOM ============== */
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
const lipsEl    = document.getElementById('lips-state'); // si no existe, no pasa nada
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

/* ============== Parámetros de detección ============== */
const DETECT_EVERY   = 3;   // un poco más frecuente
const ENTER_AR       = 0.62, EXIT_AR = 0.70;
const ENTER_OFFX     = 0.20, EXIT_OFFX = 0.16; // un pelín más sensibles
const ENTER_OFFY     = 0.28, EXIT_OFFY = 0.22;
const SCORE_ENTER    = 10,   SCORE_EXIT = 5;
const MIN_FACE_AREA  = 0.05;

const MOUTH_ENTER    = 0.36, MOUTH_EXIT = 0.28; // más estricto

const OFFTAB_EP_MS   = 1500;

/* ============== Estado ============== */
let stream=null, running=false, camRequested=false;
let frameCount=0, sessionStart=0;
let landmarker=null;

let awayScore=0, isLookAway=false;
let mouthTalk=false, occlScore=0, occluded=false;

let offTabStart=null, offTabEpisodes=0, offTabAccumMs=0;

/* ============== Métricas / loggers ============== */
const metrics    = createMetrics();
const tabLogger  = createTabLogger();
const poseLogger = createPoseLogger({ sampleMs: 200 });
const evidence   = createEvidence();

/* ============== Util/UI ============== */
const insecureContext = ()=>!(location.protocol==='https:' || location.hostname==='localhost');
const isInTab = ()=> document.visibilityState==='visible' && document.hasFocus();

function setCamStatus(kind, msg, help=''){
  camStatus?.classList.remove('pill-neutral','pill-ok','pill-warn','pill-err');
  camStatus?.classList.add('pill', kind==='ok'?'pill-ok':kind==='warn'?'pill-warn':kind==='err'?'pill-err':'pill-neutral');
  if (camStatus) camStatus.textContent = msg;
  if (camHelp){
    if (help){ camHelp.textContent = help; camHelp.classList.remove('hidden'); }
    else camHelp.classList.add('hidden');
  }
}
function releaseStream(){ try{ stream?.getTracks()?.forEach(t=>t.stop()); }catch{} stream=null; }
function syncCanvasToVideo(){ const w=cam.videoWidth||640, h=cam.videoHeight||360; canvas.width=w; canvas.height=h; }
const fmtTime = (ms)=>{ const s=Math.floor(ms/1000); const mm=String(Math.floor(s/60)).padStart(2,'0'); const ss=String(s%60).padStart(2,'0'); return `${mm}:${ss}`; };

const PERF={ fps:{green:24,amber:18}, p95:{green:200,amber:350} };
const levelFPS=v=>v>=PERF.fps.green?'ok':v>=PERF.fps.amber?'warn':'err';
const levelP95=v=>v<=PERF.p95.green?'ok':v<=PERF.p95.amber?'warn':'err';
const worst=(a,b)=>({ok:0,warn:1,err:2}[a] >= {ok:0,warn:1,err:2}[b] ? a : b);
let lastFrameTs=0; const fpsS=[], procS=[]; const MAXS=120;
const push=(a,v)=>{a.push(v); if(a.length>MAXS)a.shift();};
const median=a=>{ if(!a.length) return 0; const s=[...a].sort((x,y)=>x-y); const m=Math.floor(s.length/2); return s.length%2?s[m]:(s[m-1]+s[m])/2; };
const perc=(a,p=.95)=>{ if(!a.length) return 0; const s=[...a].sort((x,y)=>x-y); const i=Math.min(s.length-1, Math.floor(p*(s.length-1))); return s[i]; };
function updatePerfUI(){
  const fpsMed=Math.round(median(fpsS));
  const p95=Math.round(perc(procS,.95)*10)/10;
  if (fpsEl) fpsEl.textContent=fpsMed;
  if (p95El) p95El.textContent=p95;
  const lf=levelFPS(fpsMed), lp=levelP95(p95);
  perfAll && setPill(perfAll, worst(lf,lp), worst(lf,lp)==='ok'?'🟢 Óptimo': worst(lf,lp)==='warn'?'🟠 Atención':'🔴 Riesgo');
  setPill(fpsPill,lf,lf==='ok'?'🟢':lf==='warn'?'🟠':'🔴');
  setPill(p95Pill,lp,lp==='ok'?'🟢':lp==='warn'?'🟠':'🔴');
}
function setPill(el, level, label){ if(!el) return; el.classList.remove('pill-neutral','pill-ok','pill-warn','pill-err'); el.classList.add('pill',`pill-${level}`); el.textContent=label; }

/* ============== Cámara ============== */
async function startCamera(){
  if (insecureContext()){ setCamStatus('warn','HTTPS requerido','Abre con candado (HTTPS) o localhost.'); return; }
  try{
    stream = await navigator.mediaDevices.getUserMedia({ video:{ width:1280, height:720 } });
    cam.srcObject = stream; await cam.play?.();
    if (cam.readyState>=2) syncCanvasToVideo(); else cam.addEventListener('loadedmetadata', syncCanvasToVideo, {once:true});
    setCamStatus('ok', `Listo (${cam.videoWidth||1280}x${cam.videoHeight||720})`, 'La cámara está activa. Puedes Iniciar.');

    // modelo
    (async ()=>{
      try{
        if (!landmarker){
          const wasmBase = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm";
          const fileset = await FilesetResolver.forVisionTasks(wasmBase);
          landmarker = await FaceLandmarker.createFromOptions(fileset, {
            baseOptions: { modelAssetPath:"https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task" },
            runningMode: "VIDEO",
            numFaces: 1,
            outputFaceBlendshapes: true,
          });
        }
      }catch(err){ console.warn("FaceLandmarker no disponible:", err); }
    })();
  }catch(e){
    const n = e?.name || 'CameraError';
    if (n==='NotAllowedError' || n==='SecurityError') setCamStatus('err','Permiso denegado','Candado → Cámara: Permitir.');
    else if (n==='NotFoundError' || n==='OverconstrainedError') setCamStatus('err','Sin cámara','Conecta una webcam o verifica drivers.');
    else if (n==='NotReadableError') setCamStatus('warn','Cámara ocupada','Cierra Zoom/Meet/Teams y reintenta.');
    else setCamStatus('err','Error de cámara',`Detalle: ${n}`);
  }
}

/* ============== Loop ============== */
function loop(){
  if (!running) return;
  if (cam.readyState < 2){ requestAnimationFrame(loop); return; }

  const t0 = performance.now();
  ctx.drawImage(cam, 0,0, canvas.width, canvas.height);
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

  // -------- Detección (sin gate por currentTime) --------
  if (landmarker && frameCount % DETECT_EVERY === 0){
    const ts = performance.now();
    const out = landmarker.detectForVideo(cam, ts);
    const lm  = out?.faceLandmarks?.[0];

    let awayNow=false, backNow=false;
    let yaw=0, pitch=0, occl=0, gazeH=0, gazeV=0, mouth=0;

    if (!lm){
      awayNow = true;
      occl = 1;
      occlScore = Math.min(10, occlScore+1);
    } else {
      let minx=1,maxx=0,miny=1,maxy=0;
      for (const p of lm){ if(p.x<minx)minx=p.x; if(p.x>maxx)maxx=p.x; if(p.y<miny)miny=p.y; if(p.y>maxy)maxy=p.y; }
      const w=maxx-minx, h=maxy-miny, area=w*h;
      const ar = w/(h+1e-6);
      const cx=(minx+maxx)/2, cy=(miny+maxy)/2;
      const nose = lm[1] || lm[4] || lm[0];
      const offX = Math.abs((nose.x - cx) / (w + 1e-6));
      const offY = Math.abs((nose.y - cy) / (h + 1e-6));

      yaw   = Math.max(-1, Math.min(1, (nose.x - cx)/(w+1e-6)));
      pitch = Math.max(-1, Math.min(1, (nose.y - cy)/(h+1e-6)));

      occl = area < MIN_FACE_AREA ? 1 : 0;
      occlScore = Math.max(0, occl ? occlScore+1 : occlScore-1);
      const occlStable = occlScore >= 6;

      if (area >= MIN_FACE_AREA){
        awayNow = (ar < ENTER_AR) || (offX > ENTER_OFFX) || (offY > ENTER_OFFY);
        backNow = (ar > EXIT_AR)  && (offX < EXIT_OFFX) && (offY < EXIT_OFFY);
      }

      const bs = out?.faceBlendshapes?.[0]?.categories || [];
      const S  = Object.fromEntries(bs.map(c=>[c.categoryName, c.score]));
      const up   = ((S.eyeLookUpLeft||0)+(S.eyeLookUpRight||0))/2;
      const down = ((S.eyeLookDownLeft||0)+(S.eyeLookDownRight||0))/2;
      const outL = (S.eyeLookOutLeft||0), outR = (S.eyeLookOutRight||0);
      const inL  = (S.eyeLookInLeft||0),  inR  = (S.eyeLookInRight||0);
      gazeH = (outR + inL) - (outL + inR);
      gazeV = (up) - (down);

      // habla estricta
      const mouthAux = (0.6*(S.jawOpen||0) + 0.4*(
        (S.mouthUpperUpLeft||0)+(S.mouthUpperUpRight||0)+
        (S.mouthLowerDownLeft||0)+(S.mouthLowerDownRight||0)
      )/4);
      if (!mouthTalk && mouthAux >= MOUTH_ENTER){ mouthTalk = true; evidence.snapshot('alert/speech','Posible habla', canvas); }
      if (mouthTalk && mouthAux <= MOUTH_EXIT){ mouthTalk = false; }
      mouth = mouthAux;

      // integrador de mirada
      if (awayNow) awayScore = Math.min(SCORE_ENTER, awayScore + 1);
      else if (backNow) awayScore = Math.max(0, awayScore - 2);
      else awayScore = Math.max(0, awayScore - 1);

      if (!isLookAway && awayScore >= SCORE_ENTER){
        isLookAway = true;
        evidence.snapshot('alert/lookAway','Mirada desviada sostenida', canvas);
      }
      if (isLookAway && awayScore <= SCORE_EXIT){
        isLookAway = false;
      }

      // oclusión estable
      if (!occluded && occlStable){
        occluded = true;
        evidence.snapshot('alert/occlusion','Rostro cubierto/fuera', canvas);
      }
      if (occluded && !occlStable) occluded = false;
    }

    // UI y logging
    const nowVisible = isInTab();
    let attnState = 'atento';
    if (!nowVisible){
      const hiddenFor = offTabStart ? (performance.now() - offTabStart) : 0;
      attnState = hiddenFor >= 2000 ? 'distracción (fuera de pestaña)' : 'intermitente';
    } else if (isLookAway){ attnState = 'mirada desviada'; }
    attnEl && (attnEl.textContent = attnState);
    lipsEl && (lipsEl.textContent = mouthTalk ? 'posible habla' : '—');

    poseLogger.log({ yaw, pitch, mouth, occl, gazeH, gazeV, lookAway:isLookAway, inTab:nowVisible });
  }

  // off-tab acumulado
  const accum = offTabAccumMs + (offTabStart ? (performance.now() - offTabStart) : 0);
  offTimeEl && (offTimeEl.textContent = fmtTime(accum));
  offCntEl  && (offCntEl.textContent  = String(offTabEpisodes));

  requestAnimationFrame(loop);
}

/* ============== Off-tab acumulado para UI ============== */
function handleTabStateChange(){
  if (!running) return;
  const now = performance.now();
  const inTab = isInTab();
  if (!inTab){
    if (offTabStart == null) offTabStart = now;
  } else if (offTabStart != null){
    const dur = now - offTabStart;
    if (dur >= OFFTAB_EP_MS) offTabEpisodes += 1;
    offTabAccumMs += dur;
    offTabStart = null;
  }
}
document.addEventListener('visibilitychange', handleTabStateChange);
window.addEventListener('focus', handleTabStateChange);
window.addEventListener('blur', handleTabStateChange);

/* ============== TabLogger -> evidencia de off-tab ============== */
tabLogger.setOnAlert?.((type)=>{
  if (type === 'off_tab'){
    evidence.snapshot('alert/off_tab','Fuera de pestaña ≥ umbral', canvas);
  }
});

/* ============== Evidencias (modal) ============== */
function openEvidenceModal(){
  const grid = document.getElementById('evidence-grid');
  const mb   = document.getElementById('evidence-backdrop');
  const mm   = document.getElementById('evidence-modal');
  if (!grid || !mb || !mm){ alert('Falta el modal de evidencias en el HTML.'); return; }
  grid.innerHTML = '';
  const items = evidence.list();
  if (!items.length){
    grid.innerHTML = `<div class="help">Aún no hay evidencias. Gira la cabeza, tapa el rostro, habla o sal de la pestaña.</div>`;
  } else {
    for (const it of items){
      const card = document.createElement('div');
      card.className = 'ev-card';
      card.innerHTML = `
        <div class="ev-kind pill pill-warn">${it.kind}</div>
        <img src="${it.data}" alt="${it.kind}" />
        <div class="ev-note">${new Date(it.t).toLocaleTimeString()} — ${it.note||''}</div>
      `;
      grid.appendChild(card);
    }
  }
  mb.classList.remove('hidden'); mm.classList.remove('hidden');
}

/* ============== Handlers UI ============== */
btnPermitir?.addEventListener('click', async ()=>{ camRequested = true; await startCamera(); });
btnRetry?.addEventListener('click', ()=>{ releaseStream(); setCamStatus('neutral','Permiso pendiente','Presiona “Permitir cámara”.'); });

btnStart?.addEventListener('click', ()=>{
  if (!cam.srcObject){ alert('Primero permite la cámara.'); return; }
  running = true;
  frameCount=0; sessionStart=performance.now(); lastFrameTs=0; fpsS.length=0; procS.length=0;
  offTabStart = isInTab() ? null : performance.now(); offTabEpisodes=0; offTabAccumMs=0;
  awayScore=0; isLookAway=false; mouthTalk=false; occluded=false; occlScore=0;
  sessionStatus && (sessionStatus.textContent='Monitoreando');
  tabLogger.start?.(); poseLogger.start(); evidence.clear();
  loop();
});

btnStop?.addEventListener('click', ()=>{
  if (offTabStart != null){
    const now = performance.now(), dur = now - offTabStart;
    if (dur >= OFFTAB_EP_MS) offTabEpisodes += 1;
    offTabAccumMs += dur; offTabStart=null;
  }
  running=false;
  sessionStatus && (sessionStatus.textContent='Detenida');
  tabLogger.stopAndDownloadCSV?.();
  poseLogger.stop(); poseLogger.downloadCSV('poses.csv'); poseLogger.downloadSummaryJSON('poses_summary.json');
});

btnEvid?.addEventListener('click', openEvidenceModal);
btnEvidClose?.addEventListener('click', ()=>{
  document.getElementById('evidence-backdrop')?.classList.add('hidden');
  document.getElementById('evidence-modal')?.classList.add('hidden');
});
btnEvidDl?.addEventListener('click', ()=> evidence.downloadJSON('evidencias.json') );

/* ============== Tabs ============== */
function showSection(key){
  for (const k of Object.keys(sections)){ const el=sections[k]; if(!el) continue; (k===key)?el.classList.remove('hidden'):el.classList.add('hidden'); }
  tabButtons.forEach(b => b.classList.toggle('active', b.dataset.t===key));
}
tabButtons.forEach(btn=>btn.addEventListener('click', ()=>{ const k=btn.dataset.t; if(k) showSection(k); }));
showSection(tabButtons.find(b=>b.classList.contains('active'))?.dataset.t || 'lectura');

/* ============== Init ============== */
(function init(){
  if (!navigator.mediaDevices?.getUserMedia){ setCamStatus('err','No soportado','Usa Chrome/Edge.'); return; }
  if (insecureContext()){ setCamStatus('warn','HTTPS requerido','Abre con candado (HTTPS) o localhost.'); return; }
  setCamStatus('neutral','Permiso pendiente','Presiona “Permitir cámara”.');
  sessionStatus && (sessionStatus.textContent='Detenida');
  sessionTime && (sessionTime.textContent='00:00');
  fpsEl&&(fpsEl.textContent='0'); p95El&&(p95El.textContent='0.0');
  tabState&&(tabState.textContent='—'); attnEl&&(attnEl.textContent='—'); lipsEl&&(lipsEl.textContent='—');
  offCntEl&&(offCntEl.textContent='0'); offTimeEl&&(offTimeEl.textContent='00:00');
})();
