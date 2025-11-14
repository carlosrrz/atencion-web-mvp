import { pool } from '../../lib/db.js';
import { getUserFromReq } from '../../lib/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok:false, error:'Method Not Allowed' });

  const user = getUserFromReq(req);
  if (!user || user.role !== 'prof') return res.status(403).json({ ok:false, error:'Solo profesor' });

  const { name, questions, activate = true } = req.body || {};
  if (!name || !Array.isArray(questions) || questions.length === 0)
    return res.status(400).json({ ok:false, error:'Payload inválido' });

  // Validación muy simple de formato
  for (const q of questions) {
    if (!q.text || !Array.isArray(q.options) || typeof q.correct !== 'number') {
      return res.status(400).json({ ok:false, error:'Formato de pregunta inválido' });
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (activate) {
      await client.query('UPDATE exams SET is_active=false WHERE is_active=true');
    }
    const ins = `INSERT INTO exams(name, created_by, questions, is_active)
                 VALUES($1,$2,$3,$4) RETURNING id`;
    const { rows:[row] } = await client.query(ins, [name, user.id, JSON.stringify(questions), !!activate]);
    await client.query('COMMIT');
    return res.status(200).json({ ok:true, examId: row.id });
  } catch (e) {
    await client.query('ROLLBACK');
    return res.status(500).json({ ok:false, error:e.message });
  } finally {
    client.release();
  }
}
