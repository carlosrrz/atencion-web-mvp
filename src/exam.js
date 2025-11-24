// src/src/exam.js — Lógica del test del estudiante

const examCodeInput = document.getElementById('exam-code');
const btnExamStart  = document.getElementById('btn-exam-start');
const btnNext       = document.getElementById('btn-exam-next');
const btnFinish     = document.getElementById('btn-exam-finish');

const qText      = document.getElementById('q-text');
const qOptions   = document.getElementById('q-options');
const examResult = document.getElementById('exam-result');
const examIdx    = document.getElementById('exam-idx');
const examTotal  = document.getElementById('exam-total');
const examRT     = document.getElementById('exam-rt');

// Algo razonable: 3–12 caracteres (pueden ser números o letras)
const EXAM_CODE_RE = /^[A-Za-z0-9]{3,12}$/;

let currentExam = null;
let idx = 0;
let answers = [];
let questionStartTs = null;

// ---------- Helpers de UI ----------

function resetState() {
  currentExam = null;
  idx = 0;
  answers = [];
  questionStartTs = null;

  if (examIdx)   examIdx.textContent = '0';
  if (examTotal) examTotal.textContent = '0';
  if (examRT)    examRT.textContent = '0.0';
  if (qText)     qText.textContent = '---';
  if (qOptions)  qOptions.innerHTML = '';

  if (examResult) {
    examResult.textContent = '';
    examResult.classList.add('hidden');
  }

  if (btnNext)   btnNext.classList.add('hidden');
  if (btnFinish) btnFinish.classList.add('hidden');

  if (btnExamStart) {
    btnExamStart.classList.remove('hidden');
    btnExamStart.disabled = false;
    btnExamStart.textContent = 'Iniciar test';
  }

  if (examCodeInput) {
    examCodeInput.disabled = false;
  }
}

function markSelected(optIndex) {
  if (!qOptions) return;
  [...qOptions.children].forEach((el, i) => {
    if (i === optIndex) el.classList.add('selected');
    else el.classList.remove('selected');
  });
}

function renderQuestion() {
  if (!currentExam) return;
  const q = currentExam.questions[idx];
  if (!q) return;

  if (examIdx)   examIdx.textContent = String(idx + 1);
  if (examTotal) examTotal.textContent = String(currentExam.questions.length);
  if (qText)     qText.textContent = q.text || `Pregunta ${idx + 1}`;

  if (qOptions) {
    qOptions.innerHTML = '';

    (q.options || []).forEach((opt, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'q-option';
      btn.textContent = opt;
      btn.addEventListener('click', () => {
        answers[idx] = i;
        markSelected(i);
      });
      qOptions.appendChild(btn);
    });

    if (typeof answers[idx] === 'number') {
      markSelected(answers[idx]);
    }
  }

  questionStartTs = performance.now();
  if (examRT) examRT.textContent = '0.0';
}

function computeScore() {
  if (!currentExam) return { correct: 0, total: 0 };
  const qs = currentExam.questions || [];
  let correct = 0;

  qs.forEach((q, i) => {
    const ans = answers[i];
    if (typeof ans === 'number' && Number(ans) === Number(q.correct)) {
      correct++;
    }
  });

  return { correct, total: qs.length };
}

// ---------- Handlers principales ----------

async function startExam() {
  if (!examCodeInput) return;
  const code = examCodeInput.value.trim();

  if (!code) {
    alert('Ingresa el código de examen.');
    return;
  }
  if (!EXAM_CODE_RE.test(code)) {
    alert('Código de examen inválido.');
    return;
  }

  // Que la cámara esté lista (la marca app.js en window.__camReady)
  if (!window.__camReady) {
    alert('Primero permite la cámara antes de iniciar el test.');
    return;
  }

  btnExamStart.disabled = true;
  btnExamStart.textContent = 'Cargando...';

  try {
    const res = await fetch('/api/exams/current', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code })
    });

    const j = await res.json().catch(() => ({}));

    if (!res.ok || !j.ok || !j.exam) {
      alert(j.error || 'No se pudo cargar el examen.');
      btnExamStart.disabled = false;
      btnExamStart.textContent = 'Iniciar test';
      return;
    }

    const questions = Array.isArray(j.exam.questions) ? j.exam.questions : [];
    if (!questions.length) {
      alert('Este examen no tiene preguntas configuradas.');
      btnExamStart.disabled = false;
      btnExamStart.textContent = 'Iniciar test';
      return;
    }

    currentExam = {
      id: j.exam.id,
      name: j.exam.name,
      accessCode: j.exam.accessCode,
      questions
    };

    idx = 0;
    answers = [];

    if (examResult) {
      examResult.classList.add('hidden');
      examResult.textContent = '';
    }

    examCodeInput.disabled = true;
    btnExamStart.classList.add('hidden');
    btnNext.classList.remove('hidden');
    btnFinish.classList.remove('hidden');

    renderQuestion();
  } catch (err) {
    console.error('[exam] error al obtener examen', err);
    alert('Error de red al obtener examen.');
    btnExamStart.disabled = false;
    btnExamStart.textContent = 'Iniciar test';
  }
}

function onNextQuestion() {
  if (!currentExam) return;
  const qs = currentExam.questions || [];

  if (typeof answers[idx] !== 'number') {
    const cont = confirm(
      'No has marcado respuesta para esta pregunta. ¿Continuar igualmente?'
    );
    if (!cont) return;
  }

  if (idx < qs.length - 1) {
    idx++;
    renderQuestion();
  } else {
    onFinishExam();
  }
}

function onFinishExam() {
  if (!currentExam) return;

  const { correct, total } = computeScore();

  if (examResult) {
    examResult.textContent = `Resultado: ${correct}/${total} respuestas correctas.`;
    examResult.classList.remove('hidden');
  }

  const result = { correct, total };

  // Guardar para app.js (por si el evento se pierde)
  try {
    localStorage.setItem('proctor.last_exam', JSON.stringify(result));
  } catch {}

  // Evento que escucha app.js
  try {
    window.dispatchEvent(new CustomEvent('exam:finished', { detail: result }));
  } catch (e) {
    console.warn('[exam] no se pudo despachar exam:finished', e);
  }

  resetState();
}

// ---------- Eventos de UI ----------
btnExamStart && btnExamStart.addEventListener('click', startExam);
btnNext      && btnNext.addEventListener('click', onNextQuestion);
btnFinish    && btnFinish.addEventListener('click', onFinishExam);

// Estado inicial
resetState();
