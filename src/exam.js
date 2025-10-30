// public/js/exam.js
const root = document.getElementById('exam-root');
const startBtn = document.getElementById('btn-exam-start');

const QUESTIONS = [
  { q:'¿2 + 2 = ?', opts:['3','4','5'], a:1 },
  { q:'Capital de Francia', opts:['Roma','Madrid','París'], a:2 },
  { q:'Color del cielo despejado', opts:['Verde','Azul','Rojo'], a:1 },
];

startBtn?.addEventListener('click', ()=>renderExam());

function renderExam(){
  if (!root) return;
  let html = '<ul class="q">';
  QUESTIONS.forEach((it,idx)=>{
    html += `<li style="margin-bottom:10px">
      <div>${it.q}</div>
      ${it.opts.map((o,i)=>`
        <label style="display:block;margin:4px 0">
          <input type="radio" name="q${idx}" value="${i}"> ${o}
        </label>`).join('')}
    </li>`;
  });
  html += '</ul><button id="btn-exam-send" class="btn btn-primary">Enviar</button>';
  root.innerHTML = html;

  document.getElementById('btn-exam-send')?.addEventListener('click', ()=>{
    let score=0, total=QUESTIONS.length;
    QUESTIONS.forEach((it,i)=>{
      const v = Number((document.querySelector(`input[name="q${i}"]:checked`)||{}).value);
      if (v===it.a) score++;
    });
    // guardamos resultado básico junto con el alumno para que el encargado lo vea
    const res = { when: Date.now(), score, total };
    const arr = JSON.parse(localStorage.getItem('exam_results')||'[]'); arr.push(res);
    localStorage.setItem('exam_results', JSON.stringify(arr));
    alert(`Enviado. Puntaje: ${score}/${total}`);
  });
}
