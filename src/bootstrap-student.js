// src/bootstrap-student.js
// Carga robusta con fallback entre ./src y ../src
const CANDS = [
  { name: 'roles',      paths: ['./roles.js',      '../src/roles.js'] },
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

window.addEventListener('error', e => {
  console.error('Script error:', e.message, e.filename, e.lineno);
});
window.addEventListener('unhandledrejection', e => {
  console.error('Promise rejection:', e.reason);
});

(async () => {
  // 1) Cargar módulo de roles y gate de estudiante
  const roles = await loadOne(CANDS[0]);
  // Asegura que solo entren estudiantes
  roles.requireRole?.(['student']);

  // 2) Obtener el usuario autenticado desde el backend
  try {
    const r = await fetch('/api/auth/me', { cache: 'no-store' });
    const j = await r.json().catch(() => null);

    if (!r.ok || !j?.ok || !j.user) {
      console.warn('[bootstrap-student] /api/auth/me falló, redirigiendo a login');
      // si existe helper de logout, lo usamos; si no, redirigimos
      try {
        roles.logout?.();
      } catch {
        location.replace('login.html');
      }
      return;
    }

    // Dejamos al usuario disponible globalmente para exam.js y app.js
    window.__currentUser = j.user;
    console.info('[bootstrap-student] usuario autenticado:', j.user);
  } catch (e) {
    console.error('[bootstrap-student] error al cargar /api/auth/me', e);
    try {
      roles.logout?.();
    } catch {
      location.replace('login.html');
    }
    return;
  }

  // 3) Cargar el resto de módulos una vez que ya tenemos al usuario
  await loadOne(CANDS[1]); // metrics
  await loadOne(CANDS[2]); // tab-logger
  await loadOne(CANDS[3]); // exam
  await loadOne(CANDS[4]); // app

  console.log('[bootstrap] módulos cargados; los botones deberían responder ahora.');
})();
