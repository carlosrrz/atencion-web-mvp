// src/metrics.js
export function createMetrics() {
  let running = false;
  let lastFrameTs = null;

  // Guardamos por frame: timestamp, delta entre frames (dt) y tiempo de paso/procesamiento (step)
  const frames = [];

  /* Utilidades estadísticas */
  function median(arr) {
    if (!arr.length) return 0;
    const a = arr.slice().sort((x,y)=>x-y);
    const m = Math.floor(a.length/2);
    return a.length % 2 ? a[m] : (a[m-1] + a[m]) / 2;
  }
  function p95(arr) {
    if (!arr.length) return 0;
    const a = arr.slice().sort((x,y)=>x-y);
    const idx = Math.floor(0.95 * (a.length - 1));
    return a[idx];
  }

  /* API pública */
  function start() {
    running = true;
    frames.length = 0;
    lastFrameTs = performance.now();
  }

  function stop() {
    running = false;
  }

  // Llama esto al inicio de CADA frame; devuelve ts para medir el paso
  function onFrameStart() {
    const now = performance.now();
    if (running) {
      const dt = lastFrameTs != null ? (now - lastFrameTs) : 0;
      frames.push({ t: now, dt, step: null });
    }
    lastFrameTs = now;
    return performance.now(); // ts para medir el paso (step)
  }

  // Llama esto al final del procesamiento del frame, pasando el ts de inicio
  function onFrameEnd(tsStart) {
    if (!running || !frames.length) return;
    frames[frames.length - 1].step = performance.now() - tsStart;
  }

  // Lectura rápida para HUD (UI)
  function read() {
    const dts   = frames.map(f => f.dt).filter(v => v > 0);
    const steps = frames.map(f => f.step).filter(v => v != null);
    const fpsMed = dts.length ? Math.round(1000 / median(dts)) : 0;
    const latP95 = steps.length ? Math.round(p95(steps)) : 0;
    return { fpsMed, latP95 };
  }

  // Exporta CSV con detalle por frame y resumen al final
  function downloadCSV(filename = 'rendimiento.csv') {
    const rows = [];
    rows.push(['timestamp_ms','delta_frame_ms','step_ms'].join(','));
    for (const f of frames) {
      rows.push([
        Math.round(f.t),
        Math.round(f.dt ?? 0),
        Math.round(f.step ?? 0)
      ].join(','));
    }
    const { fpsMed, latP95 } = read();
    rows.push('');
    rows.push(['fps_median', fpsMed].join(','));
    rows.push(['latency_p95_ms', latP95].join(','));

    const csv = rows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return { start, stop, onFrameStart, onFrameEnd, read, downloadCSV };
}

