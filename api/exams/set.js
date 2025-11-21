// api/exams/set.js
import { getPool } from '../../lib/db.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok:false, error:'Method not allowed' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); }
    catch { return res.status(400).json({ ok:false, error:'JSON inválido' }); }
  }

  const name       = (body?.name ?? '').trim();
  const accessCode = (body?.accessCode ?? '').toString().trim();
  const questions  = Array.isArray(body?.questions) ? body.questions : [];

  if (!name || !accessCode || !questions.length) {
    return res.status(400).json({ ok:false, error:'Datos incompletos' });
  }

  try {
    const pool = getPool();

    // Desactivar exámenes anteriores (opcional)
    await pool.query('UPDATE exams SET is_active = FALSE WHERE is_active = TRUE');

    await pool.query(
      `INSERT INTO exams (id, name, access_code, is_active, questions)
       VALUES (gen_random_uuid(), $1, $2, TRUE, $3)`,
      [name, accessCode, questions]
    );

    return res.status(200).json({ ok:true, saved: questions.length });
  } catch (e) {
    console.error('[api/exams/set] ERROR', e);
    return res.status(500).json({ ok:false, error:'Error de servidor' });
  }
}
