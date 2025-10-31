// src/src/bootstrap-student.js
import { requireRole } from './roles.js';
requireRole('student');

// Importa módulos en orden. Si alguno falla, verás el error en consola.
import './metrics.js';
import './tab-logger.js';
import './exam.js';
import './app.js';

// Diagnóstico (si algo revienta antes de que se “enganchen” los botones)
window.addEventListener('error', (e) => console.error('Script error:', e.message, e.filename, e.lineno));
window.addEventListener('unhandledrejection', (e) => console.error('Promise rejection:', e.reason));
