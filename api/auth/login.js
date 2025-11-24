// api/auth/login.js
import bcrypt from 'bcryptjs';
import { getPool } from '../../lib/db.js';
import { signToken } from '../../lib/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ ok: false, error: 'Faltan campos' });
    }

    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT id, name, email, role, password_hash, student_code AS code
       FROM users
       WHERE email = $1`,
      [email.toLowerCase().trim()]
    );

    if (!rows.length) {
      return res.status(401).json({ ok: false, error: 'Credenciales inválidas' });
    }

    const userRow = rows[0];
    const ok = await bcrypt.compare(password, userRow.password_hash);
    if (!ok) {
      return res.status(401).json({ ok: false, error: 'Credenciales inválidas' });
    }

    const token = signToken({ id: userRow.id, role: userRow.role });
    res.setHeader(
      'Set-Cookie',
      `token=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Secure`
    );

    const { password_hash, ...user } = userRow;
    return res.status(200).json({ ok: true, user });
  } catch (err) {
    console.error('[auth/login] ERROR', err);
    return res.status(500).json({ ok: false, error: 'Login error' });
  }
}
