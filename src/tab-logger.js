// src/tab-logger.js
// Logger de pestaña con detección de "fuera de pestaña" sostenido, export CSV y RESUMEN.

export function createTabLogger(options = {}) {
  const cfg = {
    offTabThresholdMs: 2000, // tiempo mínimo fuera de pestaña para contar episodio
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

  const now = () => performance.now();

  function getState() {
    return {
      visible: document.visibilityState === 'visible',
      focused: document.hasFocus()
    };
  }
  function labelFromState(s) {
    return (s.visible && s.focused) ? 'EN_PESTAÑA' : 'FUERA_DE_PESTAÑA';
  }

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

    // Ventana y alerta (episodios de off-tab)
    const off = !(s.visible && s.focused);
    if (off) {
      if (offSince == null) offSince = rec.t;
      const dur = rec.t - offSince;
      if (dur >= cfg.offTabThresholdMs && !cooling) {
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

  function handleVis()  { if (running) snapshot('visibilitychange'); }
  function handleFocus(){ if (running) snapshot('focus'); }
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

  // ===== Resumen de sesión (conteo de episodios y tiempos) =====
  function getSummary() {
    if (!records.length) {
      return {
        durationMs: 0,
        offEpisodes: 0,
        offTotalMs: 0,
        onTotalMs: 0,
        longestOffMs: 0,
        offThresholdMs: cfg.offTabThresholdMs
      };
    }
    const startT = records[0].t;
    const endT   = records[records.length - 1].t;
    let offTotal = 0;
    let longestOff = 0;
    let offEpisodes = 0;

    let prev = records[0];
    let prevOff = !(prev.visible && prev.focused);
    let currOffStart = prevOff ? startT : null;

    for (let i = 1; i < records.length; i++) {
      const r = records[i];
      const off = !(r.visible && r.focused);
      const dt = r.t - prev.t;
      if (prevOff) offTotal += dt;

      // transiciones para contar episodios >= umbral
      if (!prevOff && off) {
        currOffStart = r.t;
      } else if (prevOff && !off) {
        const epMs = r.t - (currOffStart ?? r.t);
        if (epMs >= cfg.offTabThresholdMs) {
          offEpisodes++;
          if (epMs > longestOff) longestOff = epMs;
        }
        currOffStart = null;
      }

      prevOff = off;
      prev = r;
    }

    // cerrar si terminó en off
    if (prevOff && currOffStart != null) {
      const epMs = endT - currOffStart;
      if (epMs >= cfg.offTabThresholdMs) {
        offEpisodes++;
        if (epMs > longestOff) longestOff = epMs;
      }
    }

    const durationMs = Math.max(0, endT - startT);
    const onTotalMs  = Math.max(0, durationMs - offTotal);

    return {
      durationMs,
      offEpisodes,
      offTotalMs: Math.max(0, offTotal),
      onTotalMs,
      longestOffMs: Math.max(0, longestOff),
      offThresholdMs: cfg.offTabThresholdMs
    };
  }

  function downloadSummaryJSON(filename = 'resumen_sesion.json') {
    const summary = getSummary();
    const blob = new Blob([JSON.stringify(summary, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function downloadSummaryCSV(filename = 'resumen_sesion.csv') {
    const s = getSummary();
    const header = ['duration_ms','off_episodes','off_total_ms','on_total_ms','longest_off_ms','off_threshold_ms'];
    const row = [s.durationMs, s.offEpisodes, s.offTotalMs, s.onTotalMs, s.longestOffMs, s.offThresholdMs];
    const csv = header.join(',') + '\n' + row.join(',');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
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

  // API pública
  function onChange(fn)   { onChangeCb = typeof fn === 'function' ? fn : () => {}; }
  function setOnAlert(fn) { onAlertCb  = typeof fn === 'function' ? fn : () => {}; }
  function getRecords()   { return records.slice(); }

  return {
    start,
    stopAndDownloadCSV,
    onChange,
    setOnAlert,
    getRecords,
    getSummary,
    downloadSummaryJSON,
    downloadSummaryCSV,
    config: cfg
  };
}

