// src/src/exam.js
const QUESTIONS = [
  {
    q: "¿Cuál es la capital de Francia?",
    a: ["Madrid", "Roma", "París", "Berlín"],
    ok: 2
  },
  {
    q: "2 + 2 × 3 =",
    a: ["8", "12", "10", "6"],
    ok: 0
  },
  {
    q: "¿Qué significa 'CPU'?",
    a: ["Central Process Unit", "Central Processing Unit", "Computer Personal Unit", "Core Processing Utility"],
    ok: 1
  }
];

function el(html){ const d=document.createElement('div'); d.innerHTML=html.trim(); return d.firstElementChild; }

function renderExam(root){
  const form = el(`<form class="exam-form"></form>`);
  QUESTIONS.forEach((it, idx)=>{
    const block = el(`<fieldset class="q">
      <legend>${idx+1}. ${it.q}</legend>
      ${it.a.map((opt,i)=>`
        <label class="opt">
          <input type="radio" name="q${idx}" value="${i}" required/>
          <span>${opt}</span>
        </label>
      `).join('')}
    </fieldset>`);
    form.appendChild(block);
  });
  const actions = el(`<div class="row end">
    <button type="submit" class="btn btn-primary">Enviar</button>
  </div>`);
  form.appendChild(actions);

  form.addEventListener('submit', (e)=>{
    e.preventDefault();
    let score = 0;
    QUESTIONS.forEach((it, idx)=>{
      const v = form.querySelector(`input[name="q${idx}"]:checked`)?.value;
      if (Number(v) === it.ok) score++;
    });
    const result = {
      startedAt: window.__examStartedAt || Date.now(),
      finishedAt: Date.now(),
      total: QUESTIONS.length,
      correct: score
    };

    // Guarda intento simple en localStorage
    try{
      const key = 'mvp.exam.attempts';
      const prev = JSON.parse(localStorage.getItem(key) || '[]');
      prev.push(result);
      localStorage.setItem(key, JSON.stringify(prev));
    }catch{}

    alert(`Tu puntaje: ${score}/${QUESTIONS.length}`);
  });

  root.innerHTML = "";
  root.appendChild(form);
  window.__examStartedAt = Date.now();
}

function boot(){
  const root = document.getElementById('exam-root');
  if (!root) return;
  const btn = root.querySelector('#start-test');
  if (btn){
    btn.addEventListener('click', ()=> renderExam(root), { once:true });
  } else {
    renderExam(root);
  }
}

document.addEventListener('DOMContentLoaded', boot);
