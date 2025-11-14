// /api/auth/me.js
import { verifyToken } from '../../lib/auth.js';
import { db } from '../../lib/db.js';

export default async function handler(req, res) {
  try {
    const cookie = req.headers.cookie || '';
    const match = cookie.match(/(?:^|;\s*)token=([^;]+)/);
    if (!match) return res.status(401).json({ ok:false, error:'No token' });

    const token = decodeURIComponent(match[1]);
    const payload = verifyToken(token);

    // demo user?
    if (String(payload.id).startsWith('demo:')) {
      const role = payload.role || 'student';
      return res.status(200).json({ ok:true, user:{ id:payload.id, role, name: role==='prof'?'Profesor Demo':'Alumno Demo' }});
    }

    const q = await db.query('SELECT id,name,email,role FROM users WHERE id=$1', [payload.id]);
    if (q.rowCount === 0) return res.status(401).json({ ok:false, error:'Usuario no existe' });

    return res.status(200).json({ ok:true, user: q.rows[0] });
  } catch (e) {
    return res.status(401).json({ ok:false, error:'Token inválido' });
  }
}
