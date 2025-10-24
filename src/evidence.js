// src/evidence.js — Evidencias (snapshots) estilo "gallery view"
export function createEvidence() {
  const items = []; // {id,t,kind,note,data}

  function snapshot(kind, note, videoEl) {
    try {
      const w = videoEl.videoWidth || 640, h = videoEl.videoHeight || 360;
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      c.getContext('2d').drawImage(videoEl, 0, 0, w, h);
      const data = c.toDataURL('image/jpeg', 0.85); // mini-foto
      items.push({
        id: `${Date.now()}_${Math.random().toString(36).slice(2,7)}`,
        t: Date.now(), kind, note, data
      });
    } catch (e) { console.warn('snapshot failed', e); }
  }

  function list(filterKind = '') {
    return filterKind ? items.filter(i => i.kind.startsWith(filterKind)) : items.slice();
  }

  function downloadJSON(name='evidencias.json') {
    const payload = { generatedAt: new Date().toISOString(), items };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = name; a.click(); URL.revokeObjectURL(a.href);
  }

  function clear(){ items.length = 0; }

  return { snapshot, list, downloadJSON, clear, items };
}
