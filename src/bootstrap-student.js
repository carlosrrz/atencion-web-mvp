// src/bootstrap-student.js
// Carga robusta de módulos de la vista estudiante (sin gate de rol aquí)

const CANDS = [
  { name: 'metrics',    paths: ['./metrics.js',    '../src/metrics.js'] },
  { name: 'tab-logger', paths: ['./tab-logger.js', '../src/tab-logger.js'] },
  { name: 'exam',       paths: ['./exam.js',       '../src/exam.js'] },
  { name: 'app',        paths: ['./app.js',        '../src/app.js'] }
];

async function loadOne({ name, paths }) {
  for (const p of paths) {
    try {
      const mod = await import(p);
      console.info(`[bootstrap] OK ${name} ← ${p}`);
      return mod;
    } catch (e) {
      console.warn(`[bootstrap] fallo ${name} en ${p}`, e?.message || e);
    }
  }
  throw new Error(`[bootstrap] No se pudo cargar el módulo ${name} desde ninguna ruta`);
}

// Log de errores globales (para depurar en consola)
window.addEventListener('error', e => {
  console.error('Script error:', e.message, e.filename, e.lineno);
});
window.addEventListener('unhandledrejection', e => {
  console.error('Promise rejection:', e.reason);
});

// Carga secuencial de módulos
(async () => {
  try {
    await loadOne(CANDS[0]); // metrics
    await loadOne(CANDS[1]); // tab-logger
    await loadOne(CANDS[2]); // exam
    await loadOne(CANDS[3]); // app

    console.log('[bootstrap] módulos cargados; los botones deberían responder ahora.');
  } catch (e) {
    console.error('[bootstrap] Error crítico al cargar módulos:', e);
  }
})();
