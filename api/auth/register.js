// api/auth/register.js
import bcrypt from 'bcryptjs';
import { getPool } from '../../lib/db.js';

const EMAIL_RE = /^(?!.*\.\.)(?!.*\.$)(?!^\.)[A-Za-z0-9](?:[A-Za-z0-9._%+-]{0,62}[A-Za-z0-9])?@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok:false, error:'Method not allowed' });
  }
  try {
    const { name, email, password, role } = req.body || {};
    const mail = (email || '').trim().toLowerCase();

    if (!name || !mail || !password) {
      return res.status(400).json({ ok:false, error:'Campos incompletos' });
    }
    if (!EMAIL_RE.test(mail)) {
      return res.status(400).json({ ok:false, error:'Correo inválido' });
    }
    if (password.length < 6) {
      return res.status(400).json({ ok:false, error:'Contraseña muy corta (mín. 6)' });
    }

    const pool = getPool();
    // único por correo
    const { rows: exists } = await pool.query('SELECT 1 FROM users WHERE email=$1 LIMIT 1', [mail]);
    if (exists.length) {
      return res.status(409).json({ ok:false, error:'El correo ya está registrado' });
    }

    const hash = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      `INSERT INTO users (name, email, password_hash, role)
       VALUES ($1,$2,$3,$4)
       RETURNING id, name, email, role`,
      [name.trim(), mail, hash, (role === 'prof' ? 'prof' : 'student')]
    );

    return res.status(200).json({ ok:true, user: rows[0] });
  } catch (err) {
    console.error('[auth/register]', err);
    return res.status(500).json({ ok:false, error:'Server error' });
  }
}
