// api/exams/current.js (idea general)
import { getPool } from '../../lib/db.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok:false, error:'Method not allowed' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch {
      return res.status(400).json({ ok:false, error:'JSON inválido' });
    }
  }

  const code = (body.code || '').trim();
  if (!code) {
    return res.status(400).json({ ok:false, error:'Falta código' });
  }

  const pool = getPool();
  const { rows } = await pool.query(`
    SELECT id, name, questions, access_code
      FROM exams
     WHERE is_active = true
     ORDER BY created_at DESC
     LIMIT 1
  `);

  if (!rows.length) {
    return res.status(404).json({ ok:false, error:'No hay examen activo' });
  }

  const ex = rows[0];
  if (ex.access_code !== code) {
    return res.status(403).json({ ok:false, error:'Código incorrecto' });
  }

  return res.status(200).json({
    ok: true,
    examId: ex.id,
    name: ex.name,
    questions: ex.questions
  });
}
