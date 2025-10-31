// src/src/bootstrap-student.js
// Carga robusta con fallback entre ./src/src y ./src
const CANDS = [
  { name: 'roles',      paths: ['./roles.js',      '../src/roles.js'] },
  { name: 'metrics',    paths: ['./metrics.js',    '../src/metrics.js'] },
  { name: 'tab-logger', paths: ['./tab-logger.js', '../src/tab-logger.js'] },
  { name: 'exam',       paths: ['./exam.js',       '../src/exam.js'] },
  { name: 'app',        paths: ['./app.js',        '../src/app.js'] }
];

async function loadOne({name, paths}) {
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

window.addEventListener('error', e => console.error('Script error:', e.message, e.filename, e.lineno));
window.addEventListener('unhandledrejection', e => console.error('Promise rejection:', e.reason));

(async () => {
  // 1) roles + gate
  const roles = await loadOne(CANDS[0]);
  roles.requireRole?.('student');

  // 2) helpers y lógica (el resto son efectos secundarios que enganchan listeners)
  await loadOne(CANDS[1]); // metrics
  await loadOne(CANDS[2]); // tab-logger
  await loadOne(CANDS[3]); // exam
  await loadOne(CANDS[4]); // app

  console.log('[bootstrap] módulos cargados; los botones deberían responder ahora.');
})();
