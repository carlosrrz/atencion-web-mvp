// src/exam.js
// Banco de preguntas dinámico + test con RT y off-tab local

// src/exam.js
// src/exam.js
// src/exam.js
let QUESTIONS = [];

// ahora acepta examCode y devuelve bool
async function loadQuestions({ take = 8, examCode = null } = {}) {
  // si hay código, validamos contra el backend
  if (examCode) {
    try {
      const r = await fetch('/api/exams/current', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: examCode })
      });
      const j = await r.json();
      if (r.ok && j?.ok && Array.isArray(j.questions) && j.questions.length) {
        QUESTIONS = j.questions.slice(0, take);
        return true;
      }
      return false; // código incorrecto o examen no disponible
    } catch {
      return false;
    }
  }

  // Fallback local solo para desarrollo (sin código)
  try {
    const res = await fetch('./src/questions.json', { cache: 'no-store' });
    const bank = await res.json();
    const shuffled = bank.slice().sort(()=>Math.random()-0.5);
    QUESTIONS = shuffled.slice(0, take);
    return true;
  } catch {
    QUESTIONS = [{ id:'fallback1', text:'Sin banco disponible', options:['OK'], correct:0 }];
    return true;
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

// ===== Validación de datos del estudiante =====
const F = {
  name : document.getElementById('student-name'),
  code : document.getElementById('student-code'),
  email: document.getElementById('student-email'), // opcional
};

// Regex de correo (estricto; sin '..' ni puntos al final/inicio del local part)
const EMAIL_RE =
/^(?!.*\.\.)(?!.*\.$)(?!^\.)[A-Za-z0-9](?:[A-Za-z0-9._%+-]{0,62}[A-Za-z0-9])?@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

// Nombre: letras (incluye tildes/ñ), espacios, apóstrofes y guiones.
// 3–80 caracteres visibles (permitimos números por si los usan en el código paterno).
const NAME_RE = /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ'´`-][A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9'´`.\- ]{1,78}[A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9'´`-]$/;

// Código: 3–20, alfanumérico con - _ permitidos
// NUEVO: solo dígitos, de 3 a 20
const CODE_RE = /^[0-9]{3,20}$/;


function markInvalid(el, msg) {
  if (!el) return;
  el.classList.add('is-invalid');
  el.setAttribute('title', msg);
}
function clearInvalid(el) {
  if (!el) return;
  el.classList.remove('is-invalid');
  el.removeAttribute('title');
}

function validateStudentFields() {
  const name = (F.name?.value || '').trim();
  const code = (F.code?.value || '').trim();
  const email = (F.email?.value || '').trim().toLowerCase();

  // limpia marcas anteriores
  [F.name, F.code, F.email].forEach(clearInvalid);

  // nombre
  if (!name || name.replace(/\s+/g,'').length < 3 || !NAME_RE.test(name)) {
    markInvalid(F.name, 'Nombre inválido (3–80 caracteres, solo letras/espacios/guiones).');
    F.name?.focus();
    return { ok: false, error: 'Ingresa el nombre correctamente' };
  }

  // código
  if (!CODE_RE.test(code)) {
    markInvalid(F.code, 'Código inválido (3–20, solo letras/números, guion o guion bajo).');
    F.code?.focus();
    return { ok: false, error: 'Ingresa el ID correctamente' };
  }

  // correo (opcional)
  if (email && !EMAIL_RE.test(email)) {
    markInvalid(F.email, 'Correo inválido.');
    F.email?.focus();
    return { ok: false, error: 'Ingresa el correo correctamente' };
  }

  return {
    ok: true,
    data: { name, code, email: email || null }
  };
}

// Validación en vivo (quita el rojo al teclear)
[F.name, F.code, F.email].forEach(el => {
  el?.addEventListener('input', () => clearInvalid(el));
});



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
async function startTest() {
  // 1) Valida datos del estudiante (como ya tenías)
  const v = validateStudentFields();
  if (!v.ok) { 
    alert(v.error || 'Revisa los datos del estudiante.');
    return;
  }

  // 2) Verifica cámara
  if (!window.__camReady) {
    alert('Primero permite la cámara y confirma que está activa.');
    return;
  }

  // 3) Código de examen
  const codeInput = document.getElementById('exam-code');
  const examCode = (codeInput?.value || '').trim();

  if (!examCode) {
    alert('Ingresa el código de examen que te dio el profesor.');
    return;
  }
  if (!/^[0-9]{4,8}$/.test(examCode)) {
    alert('Código inválido (solo números, 4–8 dígitos).');
    return;
  }

  // 4) Cargar preguntas con ese código
  const ok = await loadQuestions({ take: 8, examCode });
  if (!ok) {
    alert('Código incorrecto o examen no disponible. Consulta al profesor.');
    return;
  }

  // si todo bien, ya tienes QUESTIONS y puedes seguir como antes
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

// y abajo, el listener se queda igual:
els.start?.addEventListener('click', () => { startTest(); });



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

/*
(async () => {
  await loadQuestions({ take: 8 });
  els.total.textContent = String(QUESTIONS.length);
  els.text.textContent = '...';
})();
*/
els.text.textContent = 'El examen se cargará cuando ingreses el código.';

els.start?.addEventListener('click', startTest);
els.next?.addEventListener('click', nextQuestion);
els.finish?.addEventListener('click', finishTest);
