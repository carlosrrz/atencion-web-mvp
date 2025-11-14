// api/auth/register.js
import bcrypt from 'bcryptjs';
import { getPool } from '../../lib/db.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok:false, error:'Method not allowed' });
  }
  try {
    const { name, email, password, role } = req.body || {};
    if (!name || !email || !password) {
      return res.status(400).json({ ok:false, error:'Faltan campos' });
    }
    const r = String(role || 'student').toLowerCase();
    const normRole = (r === 'profesor' ? 'prof' : r === 'estudiante' ? 'student' : r);

    const pool = getPool();
    const { rows: exists } = await pool.query(
      'SELECT 1 FROM users WHERE email=$1 LIMIT 1', [email.toLowerCase()]
    );
    if (exists.length) {
      return res.status(409).json({ ok:false, error:'Ese correo ya está registrado' });
    }

    const hash = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      `INSERT INTO users (name, email, role, password_hash)
       VALUES ($1,$2,$3,$4)
       RETURNING id, name, email, role`,
      [name, email.toLowerCase(), normRole, hash]
    );

    return res.status(200).json({ ok:true, user: rows[0] });
  } catch (err) {
    console.error('[auth/register] ERROR', err);
    return res.status(500).json({ ok:false, error:'Register error' });
  }
}
