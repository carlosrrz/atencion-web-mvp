// /api/auth/login.js
import bcrypt from 'bcryptjs';
import { db } from '../../lib/db.js';
import { signToken, setAuthCookie } from '../../lib/auth.js';

const DEMO = {
  'alumno@ejemplo.com':  { pass:'alumno123',  role:'student', name:'Alumno Demo' },
  'profesor@ejemplo.com':{ pass:'profesor123',role:'prof',    name:'Profesor Demo' }
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok:false, error:'Method not allowed' });

  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ ok:false, error:'Faltan credenciales' });

    // 1) Primero, busca en DB
    const q = await db.query('SELECT id, name, email, password_hash, role FROM users WHERE email=$1 LIMIT 1', [email]);
    if (q.rowCount === 1) {
      const u = q.rows[0];
      const ok = await bcrypt.compare(password, u.password_hash);
      if (!ok) return res.status(401).json({ ok:false, error:'Credenciales inválidas' });

      const token = signToken({ id:u.id, role:u.role });
      setAuthCookie(res, token);
      return res.status(200).json({ ok:true, user:{ id:u.id, name:u.name, email:u.email, role:u.role }});
    }

    // 2) Si no está en DB, acepta DEMO (compatibilidad)
    const demo = DEMO[email];
    if (demo && demo.pass === password) {
      // usuario “virtual” sin DB
      const token = signToken({ id:`demo:${email}`, role:demo.role });
      setAuthCookie(res, token);
      return res.status(200).json({ ok:true, user:{ id:`demo:${email}`, name:demo.name, email, role:demo.role }});
    }

    return res.status(401).json({ ok:false, error:'Credenciales inválidas' });
  } catch (e) {
    console.error('login error', e);
    return res.status(500).json({ ok:false, error:'Error servidor' });
  }
}
