export function createTabLogger() {
  let active = false;
  let lastTs = performance.now();
  const events = [];
  const push = (type) => {
    const now = performance.now();
    events.push({ t: now, type, deltaMs: now - lastTs });
    lastTs = now;
  };
  const onVis = () => { if (!active) return;
    document.visibilityState === 'visible' ? push('tab_visible') : push('tab_hidden');
  };
  const onFocus = () => active && push('window_focus');
  const onBlur  = () => active && push('window_blur');

  return {
    start() {
      if (active) return;
      active = true; lastTs = performance.now(); events.length = 0; push('session_start');
      document.addEventListener('visibilitychange', onVis);
      window.addEventListener('focus', onFocus);
      window.addEventListener('blur', onBlur);
    },
    stopAndDownloadCSV() {
      if (!active) return;
      push('session_stop'); active = false;
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('blur', onBlur);
      const rows = [['timestamp_ms','type','delta_ms']];
      events.forEach(e => rows.push([Math.round(e.t), e.type, Math.round(e.deltaMs)]));
      const csv = rows.map(r => r.join(',')).join('\n');
      const blob = new Blob([csv], {type:'text/csv'});
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = 'actividad_pestana.csv'; a.click();
    }
  };
}
