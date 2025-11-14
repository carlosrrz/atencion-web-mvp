// api/exam/active.js
import { getPool } from '../../lib/db.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT value FROM app_state WHERE key='active_exam' LIMIT 1`
    );
    if (!rows.length) {
      return res.status(404).json({ ok: false, error: 'No hay examen activo' });
    }

    const raw = rows[0].value;
    const data = typeof raw === 'string' ? JSON.parse(raw) : raw;

    return res.status(200).json({
      ok: true,
      name: data.name,
      questions: data.questions
    });
  } catch (e) {
    console.error('[exam/active]', e);
    return res.status(500).json({ ok: false, error: 'No se pudo leer el examen' });
  }
}
