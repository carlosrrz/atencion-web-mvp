// api/auth/register.js
import bcrypt from 'bcryptjs';
import { getPool } from '../../lib/db.js';

const EMAIL_RE =
  /^(?!.*\.\.)(?!.*\.$)(?!^\.)[A-Za-z0-9](?:[A-Za-z0-9._%+-]{0,62}[A-Za-z0-9])?@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

const NAME_RE =
  /^(?=.{2,60}$)[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+(?:[ '\-][A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+)*$/;

const clean = (s='') => s.normalize('NFKC').replace(/\s+/g,' ').trim();

// antes: const role = body.role;
const role = 'student';  // 🔒 siempre estudiante


export default async function handler(req, res) {
  if (req.method !== 'POST')
    return res.status(405).json({ ok:false, error:'Method not allowed' });

  try {
    let { name, email, password, role } = req.body || {};
    name = clean(name);
    email = (email || '').toLowerCase().trim();

    if (!name || !email || !password)
      return res.status(400).json({ ok:false, error:'Faltan campos' });

    if (!NAME_RE.test(name))
      return res.status(400).json({ ok:false, error:'Nombre inválido' });

    if (!EMAIL_RE.test(email))
      return res.status(400).json({ ok:false, error:'Correo inválido' });

    if (password.length < 6)
      return res.status(400).json({ ok:false, error:'Contraseña muy corta' });

    const pool = getPool();

    // Verifica duplicados
    const dup = await pool.query('SELECT 1 FROM users WHERE email=$1', [email]);
    if (dup.rowCount) return res.status(409).json({ ok:false, error:'El correo ya está registrado' });

    const hash = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      `INSERT INTO users (name, email, password_hash, role)
       VALUES ($1,$2,$3,$4)
       RETURNING id, name, email, role`,
      [name, email, hash, role === 'prof' ? 'prof' : 'student']
    );

    return res.status(200).json({ ok:true, user: rows[0] });
  } catch (err) {
    console.error('[auth/register] ERROR', err);
    return res.status(500).json({ ok:false, error:'Register error' });
  }
}
