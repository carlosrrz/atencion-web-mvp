// api/exam/current.js
import { getPool } from '../../lib/db.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ ok:false, error:'Method not allowed' });
  }
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT value FROM settings WHERE key='current_exam' LIMIT 1`
    );
    if (!rows.length) return res.status(404).json({ ok:false, error:'No hay examen activo' });
    return res.status(200).json({ ok:true, ...rows[0].value });
  } catch (err) {
    console.error('[exam/current] ERROR', err);
    return res.status(500).json({ ok:false, error:'Error leyendo examen' });
  }
}
