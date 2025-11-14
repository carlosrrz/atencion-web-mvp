// api/exam/set.js
import { getPool } from '../../lib/db.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }
  try {
    const { name, questions } = req.body || {};
    if (!name || !Array.isArray(questions) || !questions.length) {
      return res.status(400).json({ ok: false, error: 'name y questions[] son requeridos' });
    }

    const pool = getPool();
    await pool.query(
      `INSERT INTO app_state(key, value, updated_at)
       VALUES ('active_exam', $1::jsonb, now())
       ON CONFLICT (key) DO UPDATE
       SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
      [JSON.stringify({ name, questions })]
    );

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('[exam/set]', e);
    return res.status(500).json({ ok: false, error: 'No se pudo guardar el examen' });
  }
}
