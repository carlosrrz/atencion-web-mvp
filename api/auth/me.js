// /api/auth/me.js
import { verifyToken } from '../../lib/auth.js';
import { db } from '../../lib/db.js';

export default async function handler(req, res) {
  try {
    const cookie = req.headers.cookie || '';
    const match = cookie.match(/(?:^|;\s*)token=([^;]+)/);
    if (!match) {
      return res.status(401).json({ ok: false, error: 'No token' });
    }

    const token = decodeURIComponent(match[1]);
    const payload = verifyToken(token);

    // Usuario demo (sin BD)
    if (String(payload.id).startsWith('demo:')) {
      const role = payload.role || 'student';
      const user = {
        id: payload.id,
        role,
        name: role === 'prof' ? 'Profesor Demo' : 'Alumno Demo',
        email: null,
        studentId: null,
        studentCode: null
      };
      return res.status(200).json({ ok: true, user });
    }

    // Usuario real: unimos con students para sacar el código
    const q = await db.query(
      `SELECT
         u.id,
         u.name,
         u.email,
         u.role,
         s.id   AS student_id,
         s.code AS student_code
       FROM users u
       LEFT JOIN students s
         ON s.email = u.email
       WHERE u.id = $1`,
      [payload.id]
    );

    if (q.rowCount === 0) {
      return res.status(401).json({ ok: false, error: 'Usuario no existe' });
    }

    const row = q.rows[0];

    const user = {
      id: row.id,
      name: row.name,
      email: row.email,
      role: row.role,
      // Nuevos campos para la vista estudiante
      studentId: row.student_id || null,
      studentCode: row.student_code || null
    };

    return res.status(200).json({ ok: true, user });
  } catch (e) {
    console.error('[auth/me] ERROR', e);
    return res.status(401).json({ ok: false, error: 'Token inválido' });
  }
}
