// /api/auth/register.js
import bcrypt from 'bcryptjs';
import { db } from '../../lib/db.js';
import { signToken, setAuthCookie } from '../../lib/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok:false, error:'Method not allowed' });

  try {
    const { name, email, password, role } = req.body || {};
    if (!name || !email || !password) {
      return res.status(400).json({ ok:false, error:'Faltan campos' });
    }
    const roleNorm = (role === 'prof') ? 'prof' : 'student';

    const exists = await db.query('SELECT 1 FROM users WHERE email=$1', [email]);
    if (exists.rowCount > 0) {
      return res.status(409).json({ ok:false, error:'Correo ya registrado' });
    }

    const hash = await bcrypt.hash(password, 10);
    const ins = await db.query(
      `INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,$4)
       RETURNING id, name, email, role`,
      [name, email, hash, roleNorm]
    );

    const user = ins.rows[0];
    const token = signToken({ id:user.id, role:user.role });
    setAuthCookie(res, token);

    return res.status(200).json({ ok:true, user });
  } catch (e) {
    console.error('register error', e);
    return res.status(500).json({ ok:false, error:'Error servidor' });
  }
}
