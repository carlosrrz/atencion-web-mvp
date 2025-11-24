// api/exams/current.js
import { getPool } from '../../lib/db.js';

export default async function handler(req, res) {
  // Solo aceptamos GET o POST para evitar 405 con el front
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    let code = '';

    if (req.method === 'GET') {
      code = (req.query?.code || '').trim();
    } else {
      code = (req.body?.code || '').trim();
    }

    if (!code) {
      return res
        .status(400)
        .json({ ok: false, error: 'Falta código de examen' });
    }

    const pool = getPool();

    const { rows } = await pool.query(
      `
      SELECT id, name, access_code, questions
      FROM exams
      WHERE access_code = $1
        AND is_active = TRUE
      ORDER BY created_at DESC
      LIMIT 1;
    `,
      [code]
    );

    if (!rows.length) {
      return res.status(404).json({
        ok: false,
        error: 'Código incorrecto o examen no disponible'
      });
    }

    const row = rows[0];

    return res.status(200).json({
      ok: true,
      exam: {
        id: row.id,
        name: row.name,
        accessCode: row.access_code,
        questions: row.questions || []
      }
    });
  } catch (err) {
    console.error('[exams/current] ERROR', err);
    return res
      .status(500)
      .json({ ok: false, error: 'Error interno al obtener examen' });
  }
}
