// api/auth/login.js
import bcrypt from 'bcryptjs';
import { getPool } from '../../lib/db.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok:false, error:'Method not allowed' });
  }
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ ok:false, error:'Faltan credenciales' });
    }

    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT id, name, email, role, password_hash
         FROM users WHERE email=$1 LIMIT 1`,
      [email.toLowerCase()]
    );
    if (!rows.length) {
      return res.status(401).json({ ok:false, error:'Usuario o contraseña inválidos' });
    }

    const u = rows[0];
    const ok = await bcrypt.compare(password, u.password_hash);
    if (!ok) {
      return res.status(401).json({ ok:false, error:'Usuario o contraseña inválidos' });
    }

    return res.status(200).json({
      ok:true,
      user:{ id:u.id, name:u.name, email:u.email, role:u.role }
    });
  } catch (err) {
    console.error('[auth/login] ERROR', err);
    return res.status(500).json({ ok:false, error:'Auth error' });
  }
}
