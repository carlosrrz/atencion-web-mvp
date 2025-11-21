// api/exams/current.js
import { getPool } from '../../lib/db.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok:false, error:'Method not allowed' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      return res.status(400).json({ ok:false, error:'JSON inválido' });
    }
  }

  const code = (body?.code ?? '').toString().trim();
  if (!code) {
    return res.status(400).json({ ok:false, error:'Falta código' });
  }

  try {
    const pool = getPool();

    const { rows } = await pool.query(
      `
      SELECT id, name, questions, access_code
        FROM exams
       WHERE is_active = TRUE
         AND access_code = $1
       ORDER BY created_at DESC
       LIMIT 1
      `,
      [code]
    );

    if (!rows.length) {
      // No hay examen activo con ese código
      return res.status(404).json({
        ok: false,
        error: 'Código incorrecto o examen no disponible'
      });
    }

    const ex = rows[0];

    return res.status(200).json({
      ok: true,
      examId: ex.id,
      name: ex.name,
      questions: ex.questions
    });
  } catch (e) {
    console.error('[api/exams/current] ERROR', e);
    return res.status(500).json({ ok:false, error:'Error de servidor' });
  }
}
