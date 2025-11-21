// api/attempt/get.js
import { getPool } from '../lib/db.js'; // ajusta la ruta a tu helper de DB

export default async function handler(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const id = url.searchParams.get('id');
    if (!id) return res.status(400).json({ ok:false, error:'id requerido' });

    const pool = await getPool();
    const { rows } = await pool.query('SELECT * FROM attempts WHERE id = $1 LIMIT 1', [id]);
    if (!rows.length) return res.status(404).json({ ok:false, error:'not_found' });

    // Asegúrate de que "evidences" sea JSON (json/jsonb en la tabla)
    const attempt = rows[0];
    return res.status(200).json({ ok:true, attempt });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok:false, error:'server_error' });
  }
}
