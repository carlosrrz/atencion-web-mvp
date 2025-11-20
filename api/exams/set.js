// api/exam/set.js
import { getPool } from '../../lib/db.js';

function normalizeQuestions(input) {
  const arr = Array.isArray(input) ? input : (input?.questions || []);
  // Asegura forma: {id, text, options: string[], correct: number}
  return arr.map((q, i) => ({
    id: q.id ?? `q_${i+1}`,
    text: String(q.text ?? ''),
    options: (q.options ?? []).map(String),
    correct: Number(q.correct ?? 0)
  })).filter(q => q.text && q.options.length >= 2);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok:false, error:'Method not allowed' });
  }
  try {
    const { name, questions } = req.body || {};
    if (!name || !questions) {
      return res.status(400).json({ ok:false, error:'Falta name o questions' });
    }
    const norm = normalizeQuestions(questions);
    if (!norm.length) {
      return res.status(400).json({ ok:false, error:'Questions vacío o inválido' });
    }

    const pool = getPool();
    await pool.query(
      `INSERT INTO settings (key, value, updated_at)
       VALUES ('current_exam', $1, now())
       ON CONFLICT (key) DO UPDATE
       SET value = EXCLUDED.value, updated_at = now()`,
      [JSON.stringify({ name, questions: norm })]
    );

    return res.status(200).json({ ok:true, saved: norm.length });
  } catch (err) {
    console.error('[exam/set] ERROR', err);
    return res.status(500).json({ ok:false, error:'Error guardando examen' });
  }
}
