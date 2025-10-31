// src/exam.js
// Test corto de distracción (5 preguntas). Mide RT y off-tab durante el test.

const QUESTIONS = [
  {
    id: 'q1',
    text: 'En un bloque de estudio eficaz para cursos técnicos, ¿qué combinación es más recomendable?',
    options: [
      'Lectura pasiva prolongada sin pausas',
      'Bloques cortos con práctica activa entre secciones',
      'Ver varios videos en paralelo',
      'Responder mensajes durante el estudio para “descansar”'
    ],
    correct: 1
  },
  {
    id: 'q2',
    text: 'En complejidad algorítmica, ¿qué notación describe mejor “crece a lo sumo linealmente”?',
    options: ['Ω(n)', 'o(n)', 'O(n)', 'Θ(n log n)'],
    correct: 2
  },
  {
    id: 'q3',
    text: 'Para gestionar versiones en equipo, ¿qué práctica es más segura?',
    options: [
      'Trabajar todos en la rama main sin revisiones',
      'Crear ramas por funcionalidad y abrir solicitudes de cambios (PR)',
      'Subir archivos binarios grandes al repositorio',
      'Hacer commits con mensajes genéricos como “arreglos”'
    ],
    correct: 1
  },
  {
    id: 'q4',
    text: '¿Cuál es una buena estrategia para evitar distracciones en sesiones de programación?',
    options: [
      'Mantener abiertas varias redes sociales para “pausas activas”',
      'Usar una sola pestaña principal y registrar interrupciones para la pausa',
      'Incrementar el brillo al máximo',
      'Escuchar audios con letras mientras se escribe código'
    ],
    correct: 1
  },
  {
    id: 'q5',
    text: 'Respecto a contraseñas, ¿qué práctica es más adecuada?',
    options: [
      'Reutilizar la misma contraseña segura en varios servicios',
      'Guardar contraseñas en un documento sin cifrar',
      'Usar un gestor de contraseñas y 2FA cuando esté disponible',
      'Compartir contraseñas con el equipo por correo'
    ],
    correct: 2
  },
  {
    id: 'q6',
    text: 'En redes, ¿qué capa del modelo OSI corresponde a “Transporte”?',
    options: ['Capa 2', 'Capa 3', 'Capa 4', 'Capa 7'],
    correct: 2
  },
  {
    id: 'q7',
    text: 'Para aprender estructuras de datos, ¿qué enfoque favorece la retención?',
    options: [
      'Leer un capítulo completo sin practicar',
      'Implementar y probar pequeñas funciones tras cada concepto',
      'Memorizar todas las definiciones antes de programar',
      'Evitar cometer errores para no perder tiempo'
    ],
    correct: 1
  },
  {
    id: 'q8',
    text: 'Durante el estudio, salir repetidamente de la pestaña por ≥2 s suele…',
    options: [
      'Mejorar la precisión',
      'Reducir atención y aumentar tiempos de respuesta',
      'No tener efecto medible',
      'Mejorar la memoria a largo plazo'
    ],
    correct: 1
  }
];


const els = {
  idx: document.getElementById('exam-idx'),
  total: document.getElementById('exam-total'),
  rt: document.getElementById('exam-rt'),
  text: document.getElementById('q-text'),
  options: document.getElementById('q-options'),
  start: document.getElementById('btn-exam-start'),
  next: document.getElementById('btn-exam-next'),
  finish: document.getElementById('btn-exam-finish'),
  result: document.getElementById('exam-result'),
  instr: document.getElementById('exam-instr')
};

let state = {
  running: false,
  i: 0,
  answers: [],            // {id, chosen, correct, rtMs}
  qStartTs: 0,
  testStartTs: 0,

  // off-tab local al test
  offThresholdMs: 2000,
  offSince: null,
  offEpisodes: 0,
  offTotalMs: 0,
  _pollTimer: null
};

function fmtMMSS(ms) {
  const s = Math.floor(ms/1000);
  const mm = String(Math.floor(s/60)).padStart(2,'0');
  const ss = String(s%60).padStart(2,'0');
  return `${mm}:${ss}`;
}

function renderQuestion() {
  const q = QUESTIONS[state.i];
  els.idx.textContent = String(state.i + 1);
  els.total.textContent = String(QUESTIONS.length);
  els.text.textContent = q.text;

  els.options.innerHTML = '';
  q.options.forEach((op, k) => {
    const id = `q_${q.id}_${k}`;
    const label = document.createElement('label');
    label.innerHTML = `
      <input type="radio" name="opt" value="${k}" id="${id}">
      <span>${op}</span>
    `;
    els.options.appendChild(label);
  });

  els.rt.textContent = '0.0';
  state.qStartTs = performance.now();
}

function getChosen() {
  const sel = els.options.querySelector('input[name="opt"]:checked');
  return sel ? parseInt(sel.value, 10) : null;
}

function submitCurrent() {
  const chosen = getChosen();
  if (chosen == null) {
    alert('Selecciona una opción antes de continuar.');
    return false;
  }
  const rtMs = performance.now() - state.qStartTs;
  const q = QUESTIONS[state.i];
  state.answers.push({ id: q.id, chosen, correct: Number(chosen === q.correct), rtMs });
  els.rt.textContent = (rtMs / 1000).toFixed(2);
  return true;
}

/* ====== Off-tab local al test ====== */
function isOff() {
  return !(document.visibilityState === 'visible' && document.hasFocus());
}
function pollOff() {
  if (!state.running) return;
  const off = isOff();
  const t = performance.now();
  if (off) {
    if (state.offSince == null) state.offSince = t;
  } else if (state.offSince != null) {
    const dur = t - state.offSince;
    state.offTotalMs += dur;
    if (dur >= state.offThresholdMs) state.offEpisodes++;
    state.offSince = null;
  }
  state._pollTimer = setTimeout(pollOff, 500);
}

/* ====== Inicio/avance/final ====== */
function startTest() {
  state.running = true;
  state.i = 0;
  state.answers = [];
  state.testStartTs = performance.now();
  state.offSince = null;
  state.offTotalMs = 0;
  state.offEpisodes = 0;
  clearTimeout(state._pollTimer);
  pollOff();

  els.start.classList.add('hidden');
  els.next.classList.remove('hidden');
  els.finish.classList.add('hidden');
  els.result.classList.add('hidden');
  els.instr?.classList.add('hidden');
  els.instr?.classList.remove('hidden');

  renderQuestion();
}

function nextQuestion() {
  if (!submitCurrent()) return;
  if (state.i < QUESTIONS.length - 1) {
    state.i++;
    renderQuestion();
    // Si llega a la última, cambiamos botones
    if (state.i === QUESTIONS.length - 1) {
      els.next.classList.add('hidden');
      els.finish.classList.remove('hidden');
    }
  }
}

function finishTest() {
  if (!submitCurrent()) return;

  state.running = false;
  clearTimeout(state._pollTimer);
  // cerrar off si termina en off
  if (state.offSince != null) {
    const dur = performance.now() - state.offSince;
    state.offTotalMs += dur;
    if (dur >= state.offThresholdMs) state.offEpisodes++;
    state.offSince = null;
  }

  const correct = state.answers.reduce((a, r) => a + r.correct, 0);
  const meanRT = state.answers.reduce((a, r) => a + r.rtMs, 0) / state.answers.length;

  // Mostrar resumen
  els.result.classList.remove('hidden');
  els.result.innerHTML = `
    <strong>Resultado:</strong><br>
    Puntaje: ${correct}/${state.answers.length} (${Math.round(100*correct/state.answers.length)}%)<br>
    RT medio: ${(meanRT/1000).toFixed(2)} s<br>
    Off-tab (episodios ≥ ${Math.round(state.offThresholdMs/1000)}s): ${state.offEpisodes}<br>
    Tiempo fuera de pestaña: ${fmtMMSS(state.offTotalMs)}
  `;

  // Descargar archivos
  downloadAnswersCSV('examen_respuestas.csv');
  downloadSummaryJSON('examen_resumen.json', {
    total: state.answers.length,
    correct,
    accuracy: correct / state.answers.length,
    mean_rt_ms: Math.round(meanRT),
    off_episodes: state.offEpisodes,
    off_total_ms: Math.round(state.offTotalMs)
  });
  // ... justo antes de "els.start.classList.remove('hidden'); ..."
  window.dispatchEvent(new CustomEvent('exam:finished', {
    detail: { correct, total: state.answers.length }
  }));

  // Reset UI de botones
  els.start.classList.remove('hidden');
  els.next.classList.add('hidden');
  els.finish.classList.add('hidden');
  els.instr.classList.remove('hidden');
}

function downloadAnswersCSV(filename) {
  const rows = [['id','chosen','correct','rt_ms']];
  for (const r of state.answers) rows.push([r.id, r.chosen, r.correct, Math.round(r.rtMs)]);
  const blob = new Blob([rows.map(r=>r.join(',')).join('\n')], { type: 'text/csv' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; a.click();
  URL.revokeObjectURL(a.href);
}
function downloadSummaryJSON(filename, obj) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; a.click();
  URL.revokeObjectURL(a.href);
}

/* ====== Eventos ====== */
els.start?.addEventListener('click', startTest);
els.next?.addEventListener('click', nextQuestion);
els.finish?.addEventListener('click', finishTest);

// Inicializa contadores
els.idx.textContent = '0';
els.total.textContent = String(QUESTIONS.length);
els.rt.textContent = '0.0';