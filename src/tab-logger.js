// src/tab-logger.js
// Logger de pestaña con detección de "fuera de pestaña" sostenido y export CSV.
export function createTabLogger(options = {}) {
  const cfg = {
    offTabThresholdMs: 2000, // tiempo mínimo fuera de pestaña para alertar
    cooldownMs: 3000,        // antirrebote entre alertas
    pollMs: 500,             // muestreo periódico
    ...options
  };

  let running = false;
  let records = [];
  let timer = null;
  let offSince = null;
  let cooling = false;

  let onChangeCb = () => {};
  let onAlertCb = () => {};

  function now() { return performance.now(); }

  function snapshot(reason) {
    const s = getState();
    const rec = {
      t: now(),
      evento: reason,
      visible: s.visible ? 1 : 0,
      focused: s.focused ? 1 : 0,
      label: labelFromState(s)
    };
    records.push(rec);
    onChangeCb(rec);

    // Lógica de ventana/alerta
    const offTab = !(s.visible && s.focused);
    if (offTab) {
      if (offSince == null) offSince = rec.t;
      const dur = rec.t - offSince;
      if (dur >= cfg.offTabThresholdMs && !cooling) {
        // Publica alerta (una vez por ventana)
        onAlertCb('off_tab');
        records.push({
          t: rec.t,
          evento: 'ALERTA_OFF_TAB',
          visible: rec.visible,
          focused: rec.focused,
          label: 'ALERTA'
        });
        cooling = true;
        setTimeout(() => { cooling = false; }, cfg.cooldownMs);
      }
    } else {
      offSince = null;
    }
  }

  function getState() {
    return {
      visible: document.visibilityState === 'visible',
      focused: document.hasFocus()
    };
  }

  function labelFromState(s) {
    return (s.visible && s.focused) ? 'EN_PESTAÑA' : 'FUERA_DE_PESTAÑA';
    // Nota: cuando el navegador pierde foco o la pestaña se oculta, cuenta como fuera.
  }

  function handleVis() { if (running) snapshot('visibilitychange'); }
  function handleFocus() { if (running) snapshot('focus'); }
  function handleBlur() { if (running) snapshot('blur'); }

  function poll() {
    if (!running) return;
    snapshot('poll');
    timer = setTimeout(poll, cfg.pollMs);
  }

  function start() {
    if (running) return;
    running = true;
    records = [];
    offSince = null;
    cooling = false;

    snapshot('start');

    document.addEventListener('visibilitychange', handleVis);
    window.addEventListener('focus', handleFocus);
    window.addEventListener('blur', handleBlur);

    timer = setTimeout(poll, cfg.pollMs);
  }

  function stopAndDownloadCSV(filename = 'actividad_pestana.csv') {
    if (!running) {
      downloadCSV(filename);
      return;
    }
    running = false;
    clearTimeout(timer);
    document.removeEventListener('visibilitychange', handleVis);
    window.removeEventListener('focus', handleFocus);
    window.removeEventListener('blur', handleBlur);

    snapshot('stop');
    downloadCSV(filename);
  }

  function downloadCSV(filename) {
    if (!records.length) return;
    const rows = [['timestamp_ms','evento','visible','focused','label'].join(',')];
    for (const r of records) {
      rows.push([Math.round(r.t), r.evento, r.visible, r.focused, r.label].join(','));
    }
    const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // API para que la UI reaccione en vivo
  function onChange(fn) { onChangeCb = typeof fn === 'function' ? fn : () => {}; }
  function setOnAlert(fn) { onAlertCb = typeof fn === 'function' ? fn : () => {}; }

  return { start, stopAndDownloadCSV, onChange, setOnAlert, config: cfg };
}
