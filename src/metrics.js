// public/js/metrics.js
export function createMetrics(){
  let running=false, last=0;
  const fpsArr=[], latArr=[];
  function start(){ running=true; last=performance.now(); fpsArr.length=0; latArr.length=0; }
  function stop(){ running=false; }
  function onFrameStart(){ return performance.now(); }
  function onFrameEnd(t0){
    if(!running) return;
    const t1=performance.now();
    const dt=t1-(last||t1); last=t1;
    fpsArr.push(1000/dt); if(fpsArr.length>120) fpsArr.shift();
    latArr.push(t1-(t0||t1)); if(latArr.length>120) latArr.shift();
  }
  function read(){ return { fpsMed: median(fpsArr), latP95: percentile(latArr,95) }; }
  return { start, stop, onFrameStart, onFrameEnd, read };
}

function median(a){ if(!a.length) return 0; const b=[...a].sort((x,y)=>x-y), m=Math.floor(b.length/2); return b.length%2?b[m]:(b[m-1]+b[m])/2; }
function percentile(a,p){ if(!a.length) return 0; const b=[...a].sort((x,y)=>x-y); const i=Math.min(b.length-1, Math.floor(p/100*(b.length-1))); return b[i]; }
