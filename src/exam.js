// src/exam.js
// Banco de preguntas dinámico + test con RT y off-tab local

let QUESTIONS = []; // se llena con API o fallback

async function loadQuestions({ url = './src/questions.json', take = 8 } = {}) {
  // 1) Intenta examen activo
  try {
    const r = await fetch('/api/exam/current', { cache: 'no-store' });
    if (r.ok) {
      const j = await r.json();
      const bank = j.questions || [];
      const shuffled = bank.slice().sort(()=>Math.random()-0.5);
      QUESTIONS = shuffled.slice(0, take);
      return;
    }
  } catch {}
  // 2) Fallback local
  try {
    const res = await fetch(url, { cache: 'no-store' });
    const bank = await res.json();
    const shuffled = bank.slice().sort(()=>Math.random()-0.5);
    QUESTIONS = shuffled.slice(0, take);
  } catch {
    console.warn('[exam] fallback embebido');
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
  answers: [],
  qStartTs: 0,
  testStartTs: 0,
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
    label.className = 'q-opt';
    label.innerHTML = `
      <input type="radio" name="opt" value="${k}" id="${id}">
      <span class="text">${op}</span>
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
  if (!window.__camReady) {
    alert('Primero permite la cámara y confírmala activa.');
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

  els.start?.classList.add('hidden');
  els.next?.classList.remove('hidden');
  els.finish?.classList.add('hidden');
  els.result?.classList.add('hidden');
  els.instr?.classList.add('hidden');

  renderQuestion();
}

function nextQuestion() {
  if (!submitCurrent()) return;
  if (state.i < QUESTIONS.length - 1) {
    state.i++;
    renderQuestion();
    if (state.i === QUESTIONS.length - 1) {
      els.next?.classList.add('hidden');
      els.finish?.classList.remove('hidden');
    }
  }
}

function finishTest() {
  if (!submitCurrent()) return;

  state.running = false;
  clearTimeout(state._pollTimer);
  if (state.offSince != null) {
    const dur = performance.now() - state.offSince;
    state.offTotalMs += dur;
    if (dur >= state.offThresholdMs) state.offEpisodes++;
    state.offSince = null;
  }

  const correct = state.answers.reduce((a, r) => a + r.correct, 0);
  const meanRT = state.answers.reduce((a, r) => a + r.rtMs, 0) / state.answers.length;

  window.__examSummary = { score: correct, total: state.answers.length };
  try { localStorage.setItem('proctor.last_exam', JSON.stringify(window.__examSummary)); } catch {}

  els.result?.classList.remove('hidden');
  els.result.innerHTML = `
    <strong>Resultado:</strong><br>
    Puntaje: ${correct}/${state.answers.length} (${Math.round(100*correct/state.answers.length)}%)<br>
    RT medio: ${(meanRT/1000).toFixed(2)} s<br>
    Off-tab (episodios ≥ ${Math.round(state.offThresholdMs/1000)}s): ${state.offEpisodes}<br>
    Tiempo fuera de pestaña: ${fmtMMSS(state.offTotalMs)}
  `;

  // Notifica a la app principal
  window.dispatchEvent(new CustomEvent('exam:finished', {
    detail: { correct, total: state.answers.length }
  }));

  els.start?.classList.remove('hidden');
  els.next?.classList.add('hidden');
  els.finish?.classList.add('hidden');
  els.instr?.classList.remove('hidden');
}

/* ====== Descargas locales opcionales ====== */
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

/* ====== Init ====== */
els.idx.textContent = '0';
els.total.textContent = '0';
els.rt.textContent = '0.0';

(async () => {
  await loadQuestions({ url: './src/questions.json', take: 8 });
  els.total.textContent = String(QUESTIONS.length);
})();

els.start?.addEventListener('click', startTest);
els.next?.addEventListener('click', nextQuestion);
els.finish?.addEventListener('click', finishTest);
