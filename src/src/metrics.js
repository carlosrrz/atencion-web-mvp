export function createMetrics() {
  const frameTimes = []; // ms entre frames
  const stepTimes = [];  // ms procesamiento por frame
  let lastFrame = performance.now();

  function onFrameStart() {
    const now = performance.now();
    frameTimes.push(now - lastFrame);
    lastFrame = now;
    return performance.now();
  }
  function onFrameEnd(tsStart) {
    stepTimes.push(performance.now() - tsStart);
  }
  function median(a){const s=a.slice().sort((x,y)=>x-y);const m=Math.floor(s.length/2);return s.length?(s.length%2?s[m]:(s[m-1]+s[m])/2):0;}
  function p95(a){if(!a.length)return 0;const s=a.slice().sort((x,y)=>x-y);return s[Math.floor(0.95*(s.length-1))];}
  return {
    onFrameStart, onFrameEnd,
    read(){return { fpsMed: frameTimes.length? Math.round(1000/median(frameTimes)):0, latP95: Math.round(p95(stepTimes)) }; }
  };
}
