// src/exam.js
// Lógica del examen en la vista del estudiante

// ==== DOM ====
const inputCode   = document.getElementById('exam-code');

const qText       = document.getElementById('q-text');
const qOptions    = document.getElementById('q-options');
const examIdxEl   = document.getElementById('exam-idx');
const examTotalEl = document.getElementById('exam-total');
const examRtEl    = document.getElementById('exam-rt');
const resultEl    = document.getElementById('exam-result');

const btnStart  = document.getElementById('btn-exam-start');
const btnNext   = document.getElementById('btn-exam-next');
const btnFinish = document.getElementById('btn-exam-finish');

// ==== Estado interno ====
let exam = null;             // { title, code, questions: [{ text, options[], correctIndex }] }
let currentIdx = 0;
let selectedIdx = null;

let rtStart = 0;             // performance.now() al mostrar la pregunta
let rts = [];                // tiempo por pregunta (segundos, opcional)

let answers = [];            // índice marcado por el alumno (o null)
let finished = false;

// ==== Util ====
function normalizeExamPayload(payload) {
  if (!payload) return null;

  // Acepta { ok:true, exam:{...} } o directamente { questions:... }
  const raw = payload.exam || payload;

  const questionsSrc =
    raw.questions ||
    raw.items ||
    raw.qs ||
    [];

  const questions = questionsSrc.map((q) => ({
    text:
      q.text ||
      q.q ||
      q.question ||
      '',
    options:
      q.options ||
      q.answers ||
      q.alternatives ||
      [],
    // Puede venir como answer, correct, correctIndex, etc.
    correctIndex:
      q.correctIndex ??
      q.correct ??
      q.answer ??
      q.answerIdx ??
      (typeof q.correctAnswer === 'number' ? q.correctAnswer : null)
  }));

  return {
    title: raw.title || raw.name || 'Examen',
    code: raw.code || raw.examCode || '',
    questions
  };
}

function setLoading(isLoading) {
  if (!btnStart) return;
  btnStart.disabled = isLoading;
  btnStart.textContent = isLoading ? 'Cargando...' : 'Iniciar test';
}

function clearQuestionUI() {
  qText && (qText.textContent = '---');
  qOptions && (qOptions.innerHTML = '');
  examIdxEl && (examIdxEl.textContent = '0');
  examTotalEl && (examTotalEl.textContent = '0');
  examRtEl && (examRtEl.textContent = '0.0');
  resultEl && resultEl.classList.add('hidden');
}

// ==== Render de pregunta ====
function renderQuestion() {
  if (!exam || !exam.questions || !exam.questions.length) {
    clearQuestionUI();
    return;
  }

  const total = exam.questions.length;
  const q = exam.questions[currentIdx];

  // meta
  examIdxEl && (examIdxEl.textContent = String(currentIdx + 1));
  examTotalEl && (examTotalEl.textContent = String(total));
  examRtEl && (examRtEl.textContent = '0.0');

  // texto
  qText && (qText.textContent = q.text || '---');

  // opciones
  if (qOptions) {
    qOptions.innerHTML = '';
    (q.options || []).forEach((opt, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'q-option';
      btn.textContent = opt;

      // Aseguramos layout vertical aunque falte css
      btn.style.display = 'block';
      btn.style.width = '100%';
      btn.style.textAlign = 'left';
      btn.style.marginBottom = '8px';

      btn.dataset.index = i;

      btn.addEventListener('click', () => {
        selectedIdx = i;
        // marcar visualmente
        const all = qOptions.querySelectorAll('.q-option');
        all.forEach(b => b.classList.remove('q-option-selected'));
        btn.classList.add('q-option-selected');
      });

      qOptions.appendChild(btn);
    });
  }

  selectedIdx = answers[currentIdx] ?? null;
  if (selectedIdx != null && qOptions) {
    const btn = qOptions.querySelector(`.q-option[data-index="${selectedIdx}"]`);
    if (btn) btn.classList.add('q-option-selected');
  }

  rtStart = performance.now();
}

// Guarda respuesta y RT de la pregunta actual
function storeCurrentAnswer() {
  if (!exam) return;
  const now = performance.now();
  const dt = (now - rtStart) / 1000;
  rts[currentIdx] = dt;
  examRtEl && (examRtEl.textContent = dt.toFixed(1));

  answers[currentIdx] = selectedIdx;
}

// Calcula resultado y muestra en la vista + dispara evento
function finishExam() {
  if (!exam || finished) return;
  finished = true;

  storeCurrentAnswer();

  const total = exam.questions.length;
  let correct = 0;

  exam.questions.forEach((q, i) => {
    if (answers[i] != null && q.correctIndex != null && Number(answers[i]) === Number(q.correctIndex)) {
      correct += 1;
    }
  });

  // Mini resumen en el DOM
  if (resultEl) {
    resultEl.classList.remove('hidden');
    resultEl.innerHTML =
      `<strong>Resultado:</strong> ${correct}/${total} preguntas correctas.`;
  }

  const summary = { correct, total };

  // Guardar para app.js (por si el evento se pierde)
  try {
    localStorage.setItem('proctor.last_exam', JSON.stringify(summary));
  } catch {}

  // Disparar evento para app.js
  try {
    window.dispatchEvent(new CustomEvent('exam:finished', { detail: summary }));
  } catch (e) {
    console.warn('[exam] no se pudo disparar exam:finished', e);
  }

  // Bloquear botones
  if (btnNext) btnNext.disabled = true;
  if (btnFinish) btnFinish.disabled = true;
}

// ==== Carga desde backend ====
async function loadExamByCode(code) {
  clearQuestionUI();
  setLoading(true);
  try {
    const res = await fetch(`/api/exams/current?code=${encodeURIComponent(code)}`);
    const data = await res.json().catch(() => ({}));

    if (!res.ok || !data) {
      throw new Error(data?.error || `Error ${res.status}`);
    }

    const norm = normalizeExamPayload(data);
    if (!norm || !norm.questions || !norm.questions.length) {
      throw new Error('El examen no contiene preguntas.');
    }

    exam = norm;
    currentIdx = 0;
    answers = new Array(exam.questions.length).fill(null);
    rts = new Array(exam.questions.length).fill(0);
    finished = false;

    if (resultEl) resultEl.classList.add('hidden');
    if (btnNext) {
      btnNext.classList.remove('hidden');
      btnNext.disabled = false;
    }
    if (btnFinish) {
      btnFinish.classList.remove('hidden');
      btnFinish.disabled = false;
    }

    renderQuestion();
  } catch (err) {
    console.error('[exam] error cargando examen', err);
    alert(err.message || 'No se pudo cargar el examen.');
    exam = null;
    clearQuestionUI();
  } finally {
    setLoading(false);
  }
}

// ==== Listeners ====
btnStart?.addEventListener('click', async () => {
  const code = (inputCode?.value || '').trim();
  if (!code) {
    alert('Ingresa el código de examen que te indicó el profesor.');
    return;
  }
  await loadExamByCode(code);
});

btnNext?.addEventListener('click', () => {
  if (!exam) return;
  storeCurrentAnswer();

  if (currentIdx < exam.questions.length - 1) {
    currentIdx += 1;
    renderQuestion();

    // Si estamos en la última, oculta "Siguiente"
    if (currentIdx === exam.questions.length - 1 && btnNext) {
      btnNext.disabled = true;
    }
  }
});

btnFinish?.addEventListener('click', () => {
  if (!exam) return;
  finishExam();
});

// Si quieres permitir reiniciar el mismo examen, podrías hacer que
// btnStart vuelva a llamar loadExamByCode y resetear estado, pero
// por ahora lo dejamos como "una vez por sesión".
