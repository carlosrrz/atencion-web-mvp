// api/exams/current.js
import { getPool } from '../../lib/db.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  // ---- Parsear body ----
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); }
    catch {
      return res.status(400).json({ ok: false, error: 'JSON inválido' });
    }
  }

  const code = (body?.code || '').trim();

  if (!code) {
    return res.status(400).json({ ok: false, error: 'Falta código de examen' });
  }

  const pool = getPool();

  try {
    // Tomamos el único examen activo
    const { rows } = await pool.query(
      `SELECT id, name, questions, access_code
         FROM exams
        WHERE is_active = true
        ORDER BY created_at DESC
        LIMIT 1`
    );

    if (!rows.length) {
      return res
        .status(404)
        .json({ ok: false, error: 'No hay examen activo' });
    }

    const ex = rows[0];

    // Si el examen tiene código y no coincide → rechazamos
    if (ex.access_code && ex.access_code !== code) {
      return res
        .status(403)
        .json({ ok: false, error: 'Código incorrecto o examen no disponible' });
    }

    const questions = ex.questions || [];

    return res.status(200).json({
      ok: true,
      examId: ex.id,
      name: ex.name,
      questions
    });
  } catch (err) {
    console.error('[exams/current] ERROR', err);
    return res
      .status(500)
      .json({ ok: false, error: 'Error de servidor al cargar el examen' });
  }
}
