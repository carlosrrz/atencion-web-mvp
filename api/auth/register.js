// api/auth/register.js
import bcrypt from 'bcryptjs';
import { getPool } from '../../lib/db.js';

const EMAIL_RE =
  /^(?!.*\.\.)(?!.*\.$)(?!^\.)[A-Za-z0-9](?:[A-Za-z0-9._%+-]{0,62}[A-Za-z0-9])?@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

const NAME_RE =
  /^(?=.{2,60}$)[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+(?:[ '\-][A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+)*$/;

// Código estudiante: solo números, 3–20 dígitos
const CODE_RE = /^[0-9]{3,20}$/;

const clean = (s = '') => s.normalize('NFKC').replace(/\s+/g, ' ').trim();

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    // role viene del body pero NO lo usamos, siempre será student
    let { name, email, password, studentCode } = req.body || {};

    name = clean(name);
    email = (email || '').toLowerCase().trim();
    studentCode = (studentCode || '').trim();

    if (!name || !email || !password) {
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

    // Para estudiantes exigimos código
    if (!studentCode || !CODE_RE.test(studentCode)) {
      return res.status(400).json({
        ok: false,
        error: 'Código de estudiante inválido (solo números, 3–20 dígitos)'
      });
    }

    const pool = getPool();

    // Verifica duplicados por correo
    const dup = await pool.query('SELECT 1 FROM users WHERE email=$1', [email]);
    if (dup.rowCount) {
      return res
        .status(409)
        .json({ ok: false, error: 'El correo ya está registrado' });
    }

    const hash = await bcrypt.hash(password, 10);

    // Siempre rol student para registros vía web
    const role = 'student';

    // Usamos una conexión por si quieres envolver en transacción más adelante
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const userRes = await client.query(
        `INSERT INTO users (name, email, password_hash, role)
         VALUES ($1,$2,$3,$4)
         RETURNING id, name, email, role`,
        [name, email, hash, role]
      );
      const user = userRes.rows[0];

      // Crea / actualiza el registro en students
      await client.query(
        `INSERT INTO students (code, name, email)
         VALUES ($1,$2,$3)
         ON CONFLICT (code) DO UPDATE
           SET name  = EXCLUDED.name,
               email = EXCLUDED.email`,
        [studentCode, name, email]
      );

      await client.query('COMMIT');

      // devolvemos también el código para usarlo en el front
      return res.status(200).json({
        ok: true,
        user: { ...user, studentCode }
      });
    } catch (errTx) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('[auth/register] TX ERROR', errTx);
      return res.status(500).json({ ok: false, error: 'Register error' });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[auth/register] ERROR', err);
    return res.status(500).json({ ok: false, error: 'Register error' });
  }
}
