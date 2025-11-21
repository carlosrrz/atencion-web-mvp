// /api/attempt/get.js
import { requireAuth } from '../lib/auth.js';
import { getDb } from '../lib/db.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ ok:false, error:'Method not allowed' });

  try {
    const { user } = await requireAuth(req, res);
    if (!user || user.role !== 'prof') return res.status(401).json({ ok:false, error:'No autorizado' });

    const { id } = req.query || {};
    if (!id) return res.status(400).json({ ok:false, error:'Falta id' });

    const db = await getDb();
    // Asegúrate de que la tabla tenga la columna evidences (jsonb)
    const row = await db.oneOrNone('SELECT * FROM attempts WHERE id = $1', [id]);
    if (!row) return res.status(404).json({ ok:false, error:'No encontrado' });

    return res.json({ ok:true, item: row });
  } catch (e) {
    console.error('attempt/get', e);
    return res.status(500).json({ ok:false, error:'Error interno' });
  }
}
