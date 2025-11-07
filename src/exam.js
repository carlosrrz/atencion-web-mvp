// src/exam.js
// Test corto de distracción (5 preguntas). Mide RT y off-tab durante el test.

// --- Banco de preguntas dinámico ---
let QUESTIONS = []; // se llenará desde JSON

async function loadQuestions({ url = './src/questions.json', take = 8 } = {}) {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    const bank = await res.json();
    // baraja y toma N
    const shuffled = bank.slice().sort(()=>Math.random()-0.5);
    QUESTIONS = shuffled.slice(0, take);
  } catch (e) {
    console.warn('[exam] No se pudo cargar questions.json; usando fallback embebido');
    // Fallback mínimo si falla el fetch:
    QUESTIONS = [
      { id:'q_f1', text:'Fallback 1', options:['A','B','C','D'], correct:0 },
      { id:'q_f2', text:'Fallback 2', options:['A','B','C','D'], correct:1 }
    ];
  }
}


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
  // pre-requisito: cámara lista
  if (!window.__camReady) {
    alert('Primero permite la cámara y confirma que está activa.');
    return;
  }
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

  // Guarda un “resumen” de examen accesible por app.js al terminar la sesión
window.__examSummary = { score: correct, total: state.answers.length };
// (opcional, por si la página se refresca) – se limpia al guardar el intento
try { localStorage.setItem('proctor.last_exam', JSON.stringify(window.__examSummary)); } catch {}


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
// Inicializa contadores y carga banco
els.idx.textContent = '0';
els.total.textContent = '0';
els.rt.textContent = '0.0';

(async () => {
  await loadQuestions({ url: './src/questions.json', take: 8 });
  els.total.textContent = String(QUESTIONS.length);
  els.text.textContent = 'Presiona "Iniciar test" cuando el docente lo indique.';
})();


/* ====== Eventos ====== */
els.start?.addEventListener('click', startTest);
els.next?.addEventListener('click', nextQuestion);
els.finish?.addEventListener('click', finishTest);

// Inicializa contadores
els.idx.textContent = '0';
els.total.textContent = String(QUESTIONS.length);
els.rt.textContent = '0.0';