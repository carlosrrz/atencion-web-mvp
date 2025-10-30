// public/js/tab-logger.js
export function createTabLogger({offTabThresholdMs=1500}={}) {
  let startAt=0, offStart=null, offEpisodes=0, offTotalMs=0, longestOffMs=0;
  let onAlert = ()=>{};

  function start(){ startAt=performance.now(); offStart=null; offEpisodes=0; offTotalMs=0; longestOffMs=0; }
  function stopAndDownloadCSV(){} // opcional

  function getSummary(){
    const now=performance.now();
    const running = offStart ? (now-offStart) : 0;
    return {
      durationMs: now - startAt,
      offEpisodes,
      offTotalMs: offTotalMs + (running>=offTabThresholdMs?running:0),
      onTotalMs: 0,
      longestOffMs,
      offThresholdMs: offTabThresholdMs
    };
  }
  function setOnAlert(fn){ onAlert = fn || (()=>{}); }

  function handle(){
    const inTab = (document.visibilityState==='visible') && document.hasFocus();
    const now=performance.now();
    if(!inTab){
      if(offStart==null) offStart=now;
    }else if(offStart!=null){
      const d=now-offStart;
      if(d>=offTabThresholdMs){ offEpisodes++; longestOffMs=Math.max(longestOffMs,d); onAlert('off_tab'); }
      offTotalMs += d; offStart=null;
    }
  }
  document.addEventListener('visibilitychange', handle);
  window.addEventListener('blur', handle);
  window.addEventListener('focus', handle);

  return { start, stopAndDownloadCSV, getSummary, setOnAlert };
}
