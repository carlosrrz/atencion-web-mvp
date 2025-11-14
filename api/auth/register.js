import { pool } from '../../lib/db.js';
import { hash } from 'bcryptjs';
import { signSession, setSessionCookie } from '../../lib/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
  try {
    const { email, password, name, role = 'student', student_code } = req.body || {};
    if (!email || !password) return res.status(400).json({ ok:false, error:'Email y password son obligatorios' });
    if (!['student','prof'].includes(role)) return res.status(400).json({ ok:false, error:'Rol inválido' });

    const pw = await hash(password, 10);
    const q = `INSERT INTO users(email,password_hash,role,name,student_code)
               VALUES($1,$2,$3,$4,$5) RETURNING id,email,role,name,student_code`;
    const { rows:[user] } = await pool.query(q, [email, pw, role, name || null, student_code || null]);

    const token = signSession({ id:user.id, email:user.email, role:user.role, name:user.name, code:user.student_code });
    setSessionCookie(res, token);
    return res.status(200).json({ ok:true, user });
  } catch (e) {
    if (String(e.message).includes('duplicate')) {
      return res.status(409).json({ ok:false, error:'Email ya registrado' });
    }
    return res.status(500).json({ ok:false, error:e.message });
  }
}
