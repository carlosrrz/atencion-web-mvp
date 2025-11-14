import { pool } from '../../lib/db.js';
import { compare } from 'bcryptjs';
import { signSession, setSessionCookie } from '../../lib/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok:false, error:'Method Not Allowed' });
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ ok:false, error:'Email y password son obligatorios' });

  const { rows:[u] } = await pool.query('SELECT * FROM users WHERE email=$1', [email]);
  if (!u) return res.status(401).json({ ok:false, error:'Credenciales inválidas' });

  const ok = await compare(password, u.password_hash);
  if (!ok) return res.status(401).json({ ok:false, error:'Credenciales inválidas' });

  const token = signSession({ id:u.id, email:u.email, role:u.role, name:u.name, code:u.student_code });
  setSessionCookie(res, token);
  return res.status(200).json({ ok:true, user:{ id:u.id, email:u.email, role:u.role, name:u.name, student_code:u.student_code } });
}
