// Clave única en LocalStorage
const KEY = 'proctor.attempts.v1';

export function loadAttempts(){
  try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; }
}
export function saveAttempt(attempt){
  const all = loadAttempts();
  all.push(attempt);
  localStorage.setItem(KEY, JSON.stringify(all));
}
export function exportAllCSV(){
  const rows = [];
  rows.push([
    'id','student_name','student_code','student_email',
    'started_at','ended_at','duration_ms',
    'offtab_episodes','offtab_total_ms',
    'lookaway_episodes','lookaway_total_ms','lookaway_longest_ms',
    'occlusion_episodes','occlusion_total_ms',
    'speak_episodes','speak_total_ms',
    'fps_median','latency_p95_ms'
  ].join(','));

  for (const a of loadAttempts()){
    const s = a.summary || {};
    const ta = s.tab_activity || {};
    const att = s.attention || {};
    const occ = s.occlusion || {};
    const lip = s.lips || {};
    const perf = s.performance || {};
    rows.push([
      a.id, csv(a.student?.name), csv(a.student?.code), csv(a.student?.email),
      csv(a.startedAt), csv(a.endedAt), a.durationMs ?? '',
      ta.off_episodes ?? '', ta.off_total_ms ?? '',
      att.lookaway_episodes ?? '', att.lookaway_total_ms ?? '', att.lookaway_longest_ms ?? '',
      occ.episodes ?? '', occ.total_ms ?? '',
      lip.speak_episodes ?? '', lip.speak_total_ms ?? '',
      perf.fps_median ?? '', perf.latency_p95_ms ?? ''
    ].join(','));
  }
  downloadCSV('intentos_proctor.csv', rows.join('\n'));
}
export function exportOneCSV(attempt){
  const s = attempt.summary || {};
  const ta = s.tab_activity || {};
  const att = s.attention || {};
  const occ = s.occlusion || {};
  const lip = s.lips || {};
  const perf = s.performance || {};
  const rows = [
    ['id', attempt.id],
    ['student_name', attempt.student?.name || ''],
    ['student_code', attempt.student?.code || ''],
    ['student_email', attempt.student?.email || ''],
    ['started_at', attempt.startedAt], ['ended_at', attempt.endedAt], ['duration_ms', attempt.durationMs],
    [],
    ['offtab_episodes', ta.off_episodes], ['offtab_total_ms', ta.off_total_ms],
    ['lookaway_episodes', att.lookaway_episodes], ['lookaway_total_ms', att.lookaway_total_ms], ['lookaway_longest_ms', att.lookaway_longest_ms],
    ['occlusion_episodes', occ.episodes], ['occlusion_total_ms', occ.total_ms],
    ['speak_episodes', lip.speak_episodes], ['speak_total_ms', lip.speak_total_ms],
    [],
    ['fps_median', perf.fps_median], ['latency_p95_ms', perf.latency_p95_ms],
    [],
    ['exam_score', attempt.exam?.score ?? ''], ['exam_total', attempt.exam?.total ?? '']
  ];
  downloadCSV(`intento_${attempt.id}.csv`, rows.map(r => (Array.isArray(r)? r.join(',') : '')).join('\n'));
}
export function clearAll(){ localStorage.removeItem(KEY); }

function csv(v){ return (v==null) ? '' : String(v).replaceAll('"','""'); }
function downloadCSV(name, text){
  const blob = new Blob([text], {type:'text/csv'}); const a=document.createElement('a');
  a.href=URL.createObjectURL(blob); a.download=name; a.click(); URL.revokeObjectURL(a.href);
}
