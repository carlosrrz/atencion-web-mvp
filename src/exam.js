// exam.js
const root = document.getElementById('exam-root');
const startBtn = document.getElementById('btn-start-test');

const QUESTIONS = [
  { q: '¿Qué retorna Math.max(3, 9, 4)?',
    a: ['3','9','4','12'], correct: 1 },
  { q: 'HTTP es un protocolo del nivel…',
    a: ['Transporte','Aplicación','Enlace','Red'], correct: 1 },
  { q: '¿Cuál no es un método HTTP?',
    a: ['GET','POST','PUSH','DELETE'], correct: 2 },
  { q: 'Complejidad de búsqueda en un arreglo NO ordenado (peor caso):',
    a: ['O(1)','O(n)','O(log n)','O(n log n)'], correct: 1 },
  { q: 'En JS, typeof null es…',
    a: ['"null"','"object"','"undefined"','"number"'], correct: 1 }
];

let i = 0;
let answers = [];
let started = false;

function renderQuestion(){
  const item = QUESTIONS[i];
  root.innerHTML = `
    <div class="card" style="padding:12px;border:1px solid #eef2ff">
      <div style="margin-bottom:8px"><strong>Pregunta ${i+1} de ${QUESTIONS.length}</strong></div>
      <div style="margin:6px 0 10px">${item.q}</div>
      ${item.a.map((opt,idx)=>`
        <label style="display:block;margin:6px 0">
          <input type="radio" name="opt" value="${idx}"> ${opt}
        </label>
      `).join('')}
      <div style="display:flex;gap:10px;margin-top:10px">
        ${i>0 ? `<button id="prev-q" class="btn">Anterior</button>`:''}
        ${i<QUESTIONS.length-1
           ? `<button id="next-q" class="btn primary">Siguiente</button>`
           : `<button id="submit-q" class="btn primary">Enviar</button>`}
      </div>
    </div>
  `;

  // set selected if exists
  const prev = answers[i];
  if (prev != null){
    const radio = root.querySelector(`input[name="opt"][value="${prev}"]`);
    radio && (radio.checked = true);
  }

  root.querySelector('#next-q')?.addEventListener('click', ()=>{
    const sel = root.querySelector('input[name="opt"]:checked');
    answers[i] = sel ? Number(sel.value) : null;
    i++; renderQuestion();
  });
  root.querySelector('#prev-q')?.addEventListener('click', ()=>{
    const sel = root.querySelector('input[name="opt"]:checked');
    answers[i] = sel ? Number(sel.value) : answers[i];
    i--; renderQuestion();
  });
  root.querySelector('#submit-q')?.addEventListener('click', ()=>{
    const sel = root.querySelector('input[name="opt"]:checked');
    answers[i] = sel ? Number(sel.value) : answers[i];

    // calificar
    let ok = 0;
    QUESTIONS.forEach((q,idx)=>{ if (answers[idx] === q.correct) ok++; });

    const result = {
      alumno: JSON.parse(localStorage.getItem('alumno')||'{}'),
      startedAt: started,
      finishedAt: Date.now(),
      score: ok,
      total: QUESTIONS.length,
      answers
    };
    localStorage.setItem('resultado_examen', JSON.stringify(result));
    alert(`Enviado. Puntaje: ${ok}/${QUESTIONS.length}`);
    // opcional: bloquear edición
    startBtn.disabled = true;
  });
}

startBtn?.addEventListener('click', ()=>{
  if (startBtn.disabled) return;
  started = Date.now();
  i = 0; answers = new Array(QUESTIONS.length).fill(null);
  renderQuestion();
});
