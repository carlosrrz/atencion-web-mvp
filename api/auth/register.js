// api/auth/register.js
import bcrypt from 'bcryptjs';
import { getPool } from '../../lib/db.js';
import { verifyToken } from '../../lib/auth.js';

const EMAIL_RE =
  /^(?!.*\.\.)(?!.*\.$)(?!^\.)[A-Za-z0-9](?:[A-Za-z0-9._%+-]{0,62}[A-Za-z0-9])?@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*\.[A-Za-z]{2,4}$/;


const NAME_RE =
  /^(?=.{2,60}$)[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+(?:[ '\-][A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+)*$/;

const clean = (s = '') => s.normalize('NFKC').replace(/\s+/g, ' ').trim();

// Lee el rol del usuario autenticado (si viene con cookie "token")
function getRequesterRole(req) {
  try {
    const cookie = req.headers.cookie || '';
    const match = cookie.match(/(?:^|;\s*)token=([^;]+)/);
    if (!match) return null;
    const token = decodeURIComponent(match[1]);
    const payload = verifyToken(token);
    return payload.role || null;
  } catch {
    return null;
  }
}


export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

    try {
    let { name, email, password, studentCode, role: bodyRole } = req.body || {};

    name = clean(name);
    email = (email || '').toLowerCase().trim();

    const requesterRole = getRequesterRole(req); // admin, prof, student o null

    // Rol que realmente vamos a guardar
    let finalRole = 'student';

    // Solo si quien llama es admin se permite crear profesores
    if (requesterRole === 'admin' && bodyRole === 'prof') {
      finalRole = 'prof';
    }

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
      `INSERT INTO users (name, email, password_hash, role)
       VALUES ($1,$2,$3,$4)
       RETURNING id, name, email, role`,
      [name, email, hash, finalRole]
    );


    return res.status(200).json({ ok: true, user: rows[0] });
  } catch (err) {
    console.error('[auth/register] ERROR', err);
    return res.status(500).json({ ok: false, error: 'Register error' });
  }
}
