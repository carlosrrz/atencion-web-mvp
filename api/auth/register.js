// api/auth/register.js
import bcrypt from 'bcryptjs';
import { getPool } from '../../lib/db.js';

const EMAIL_RE =
  /^(?!.*\.\.)(?!.*\.$)(?!^\.)[A-Za-z0-9](?:[A-Za-z0-9._%+-]{0,62}[A-Za-z0-9])?@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

const NAME_RE =
  /^(?=.{2,60}$)[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+(?:[ '\-][A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+)*$/;

const clean = (s = '') => s.normalize('NFKC').replace(/\s+/g, ' ').trim();

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    // ⬅ ahora también recibimos "code"
    let { name, email, password, code, role } = req.body || {};
    name = clean(name);
    email = (email || '').toLowerCase().trim();
    code = (code || '').trim();

    if (!name || !email || !password || !code) {
      return res.status(400).json({ ok: false, error: 'Faltan campos' });
    }

    if (!NAME_RE.test(name)) {
      return res.status(400).json({ ok: false, error: 'Nombre inválido' });
    }

    if (!EMAIL_RE.test(email)) {
      return res.status(400).json({ ok: false, error: 'Correo inválido' });
    }

    if (password.length < 6) {
      return res.status(400).json({ ok: false, error: 'Contraseña muy corta' });
    }

    // código de alumno: entre 3 y 20 caracteres, sin espacios
    if (code.length < 3 || code.length > 20 || /\s/.test(code)) {
      return res.status(400).json({ ok: false, error: 'Código de alumno inválido' });
    }

    const pool = getPool();

    // ¿correo ya usado?
    const dup = await pool.query('SELECT 1 FROM users WHERE email = $1', [email]);
    if (dup.rowCount) {
      return res.status(409).json({ ok: false, error: 'El correo ya está registrado' });
    }

    const hash = await bcrypt.hash(password, 10);

    // role: por ahora siempre estudiante (si algún día usas prof, lo dejamos preparado)
    const dbRole = role === 'prof' ? 'prof' : 'student';

    const { rows } = await pool.query(
      `INSERT INTO users (name, email, password_hash, role, student_code)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, email, role, student_code AS code`,
      [name, email, hash, dbRole, code]
    );

    return res.status(200).json({ ok: true, user: rows[0] });
  } catch (err) {
    console.error('[auth/register] ERROR', err);
    return res.status(500).json({ ok: false, error: 'Register error' });
  }
}
