// src/exam.js
// Lógica del examen: carga por código, navegación de preguntas y resultado final.
// Ya NO valida nombre/código/alumno: solo código de examen + cámara activa.

const inputCode  = document.getElementById('exam-code');
const btnStart   = document.getElementById('btn-exam-start');
const btnNext    = document.getElementById('btn-exam-next');
const btnFinish  = document.getElementById('btn-exam-finish');

const spanIdx    = document.getElementById('exam-idx');
const spanTotal  = document.getElementById('exam-total');
const spanRT     = document.getElementById('exam-rt');
const divQText   = document.getElementById('q-text');
const divQOpts   = document.getElementById('q-options');
const divResult  = document.getElementById('exam-result');

if (!inputCode || !btnStart || !divQText || !divQOpts) {
  console.warn('[exam] No se encontraron elementos clave. ¿Está bien el HTML?');
}

// Código: solo números 4–8 dígitos (igual que en backend)
const EXAM_CODE_RE = /^[0-9]{4,8}$/;

const examState = {
  exam: null,          // { name, questions: [...] }
  codeUsed: null,
  idx: 0,
  started: false,
  finished: false,
  answers: [],         // índice de opción elegida por pregunta
  rtStart: 0           // performance.now() al mostrar la pregunta
};

function resetUI() {
  spanIdx && (spanIdx.textContent = '0');
  spanTotal && (spanTotal.textContent = '0');
  spanRT && (spanRT.textContent = '0.0');
  divQText && (divQText.textContent = '---');
  if (divQOpts) divQOpts.innerHTML = '';
  if (divResult) {
    divResult.textContent = '';
    divResult.classList.add('hidden');
  }
  btnNext && btnNext.classList.add('hidden');
  btnFinish && btnFinish.classList.add('hidden');
  btnStart && btnStart.classList.remove('hidden');
}

// ==== Utilidades de opciones ====

function markSelected(idx) {
  if (!divQOpts) return;
  [...divQOpts.querySelectorAll('button[data-idx]')].forEach(b => {
    const sel = Number(b.dataset.idx) === idx;
    b.dataset.selected = sel ? '1' : '0';
    b.classList.toggle('selected', sel); // por si tienes estilos
  });
}

function getSelectedIdx() {
  if (!divQOpts) return null;
  const btn = divQOpts.querySelector('button[data-selected="1"]');
  if (!btn) return null;
  return Number(btn.dataset.idx);
}

function renderQuestion() {
  const exam = examState.exam;
  if (!exam || !Array.isArray(exam.questions) || !exam.questions.length) return;

  const q = exam.questions[examState.idx];
  const total = exam.questions.length;

  spanIdx && (spanIdx.textContent = String(examState.idx + 1));
  spanTotal && (spanTotal.textContent = String(total));
  spanRT && (spanRT.textContent = '0.0');

  if (divQText) divQText.textContent = q.text || '';

  if (divQOpts) {
    divQOpts.innerHTML = '';
    (q.options || []).forEach((opt, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'secondary'; // o la clase que ya uses para opciones
      btn.textContent = opt;
      btn.dataset.idx = String(i);
      btn.dataset.selected = '0';
      btn.addEventListener('click', () => {
        markSelected(i);
      });
      divQOpts.appendChild(btn);
    });
  }

  // botón siguiente / finalizar
  if (btnNext)   btnNext.classList.toggle('hidden', examState.idx >= total - 1);
  if (btnFinish) btnFinish.classList.toggle('hidden', examState.idx < total - 1);

  // arranca RT de esta pregunta
  examState.rtStart = performance.now();
}

function commitCurrentAnswer() {
  const idx = getSelectedIdx();
  if (idx == null) {
    alert('Selecciona una opción antes de continuar.');
    return false;
  }
  examState.answers[examState.idx] = idx;

  if (spanRT && examState.rtStart) {
    const rt = (performance.now() - examState.rtStart) / 1000;
    spanRT.textContent = rt.toFixed(1);
  }
  return true;
}

// ==== Carga de examen desde backend ====

async function fetchExamByCode(code) {
  const url = `/api/exams/current?code=${encodeURIComponent(code)}`;
  console.log('[exam] GET', url);
  const res = await fetch(url, { cache: 'no-store' });
  const j = await res.json().catch(() => null);

  if (!res.ok || !j?.ok || !j.exam || !Array.isArray(j.exam.questions) || !j.exam.questions.length) {
    console.warn('[exam] respuesta inválida', res.status, j);
    throw new Error(j?.error || 'Código de examen incorrecto o no disponible.');
  }

  return j.exam;
}

// ==== Finalizar examen ====

function finishExam() {
  const exam = examState.exam;
  if (!exam) return;

  const questions = exam.questions || [];
  let correct = 0;
  questions.forEach((q, i) => {
    const ansIdx = examState.answers[i];
    if (ansIdx != null && Number(ansIdx) === Number(q.correct)) {
      correct++;
    }
  });
  const total = questions.length || 0;
  const detail = {
    correct,
    total,
    score: total ? correct / total : 0
  };

  try {
    localStorage.setItem('proctor.last_exam', JSON.stringify(detail));
  } catch {}

  // evento para app.js
  try {
    window.dispatchEvent(new CustomEvent('exam:finished', { detail }));
  } catch (e) {
    console.warn('[exam] no se pudo despachar exam:finished', e);
  }

  if (divResult) {
    divResult.classList.remove('hidden');
    divResult.textContent = `Respuestas correctas: ${correct} de ${total}.`;
  }

  examState.finished = true;
  btnNext && btnNext.classList.add('hidden');
  btnFinish && btnFinish.classList.add('hidden');
  btnStart && btnStart.classList.remove('hidden');
  inputCode && (inputCode.disabled = false);
}

// ==== Handlers de botones ====

btnStart?.addEventListener('click', async () => {
  const rawCode = (inputCode?.value || '').trim();

  // 1) Validar código
  if (!rawCode) {
    alert('Ingresa el código de examen que te dio el profesor.');
    inputCode?.focus();
    return;
  }
  if (!EXAM_CODE_RE.test(rawCode)) {
    alert('Código de examen inválido (usa solo números, 4–8 dígitos).');
    inputCode?.focus();
    return;
  }

  // 2) Verificar cámara
  if (!window.__camReady) {
    alert('Antes de iniciar el examen, presiona "Permitir cámara" y verifica que el video se vea.');
    return;
  }

  try {
    btnStart.disabled = true;
    btnStart.textContent = 'Cargando...';

    const exam = await fetchExamByCode(rawCode);

    examState.exam = exam;
    examState.codeUsed = rawCode;
    examState.idx = 0;
    examState.answers = [];
    examState.started = true;
    examState.finished = false;

    if (divResult) {
      divResult.textContent = '';
      divResult.classList.add('hidden');
    }

    inputCode && (inputCode.disabled = true);

    renderQuestion();
  } catch (e) {
    console.error('[exam] error al iniciar', e);
    alert(e.message || 'No se pudo cargar el examen.');
  } finally {
    btnStart.disabled = false;
    btnStart.textContent = 'Iniciar test';
    btnStart.classList.add('hidden');  // se oculta mientras dura el examen
  }
});

btnNext?.addEventListener('click', () => {
  if (!examState.exam || !examState.started || examState.finished) return;
  if (!commitCurrentAnswer()) return;

  const total = examState.exam.questions.length;
  if (examState.idx < total - 1) {
    examState.idx++;
    renderQuestion();
  }
});

btnFinish?.addEventListener('click', () => {
  if (!examState.exam || !examState.started || examState.finished) return;
  if (!commitCurrentAnswer()) return;
  finishExam();
});

// Estado inicial
resetUI();

// Exponer para depuración si quieres
window.__examState = examState;
console.log('[exam] módulo cargado');
