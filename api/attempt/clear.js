// api/attempt/clear.js
import { getPool } from '../../lib/db.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    const pool = getPool();
    await pool.query('BEGIN');

    // 1) Borrar dependencias (si las tienes)
    await pool.query(
      'DELETE FROM evidences WHERE attempt_id IN (SELECT id FROM attempts)'
    );
    await pool.query(
      'DELETE FROM exam_attempts WHERE attempt_id IN (SELECT id FROM attempts)'
    );

    // 2) Borrar intentos
    const delAttempts = await pool.query('DELETE FROM attempts');

    await pool.query('COMMIT');

    return res
      .status(200)
      .json({ ok: true, deleted: delAttempts.rowCount });
  } catch (err) {
    try { await getPool().query('ROLLBACK'); } catch {}

    console.error('[api/attempt/clear] ERROR', err);
    return res
      .status(500)
      .json({ ok: false, error: 'Error al borrar intentos' });
  }
}
