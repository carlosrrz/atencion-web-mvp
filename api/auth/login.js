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

  // en /api/auth/login
const token = signJwt({ id: user.id, role: user.role });
// 7 días
const maxAge = 60*60*24*7;

res.setHeader('Set-Cookie', [
  `token=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}; Secure`
]);

return res.status(200).json({ ok:true, user: { id:user.id, role:user.role, name:user.name }});

}
