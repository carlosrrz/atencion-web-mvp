// api/exams/set.js
import { getPool } from '../../lib/db.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  // ---- Parsear body ----
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); }
    catch {
      return res.status(400).json({ ok: false, error: 'JSON inválido' });
    }
  }

  const name       = (body?.name || '').trim();
  const accessCode = (body?.accessCode || '').trim();
  const questions  = Array.isArray(body?.questions) ? body.questions : [];

  // ---- Validaciones básicas (mismas reglas que en el front) ----
  if (!name) {
    return res.status(400).json({ ok: false, error: 'Falta nombre de examen' });
  }

  if (!accessCode) {
    return res.status(400).json({ ok: false, error: 'Falta código de examen' });
  }

  // solo números, 4–8 dígitos
  if (!/^[0-9]{4,8}$/.test(accessCode)) {
    return res.status(400).json({ ok: false, error: 'Código de examen inválido' });
  }

  if (!questions.length) {
    return res.status(400).json({ ok: false, error: 'El examen no tiene preguntas' });
  }

  const pool = getPool();

  try {
    await pool.query('BEGIN');

    // Desactivar exámenes anteriores
    await pool.query('UPDATE exams SET is_active = false');

    // Insertar nuevo examen activo con su código
    const { rows } = await pool.query(
      `INSERT INTO exams (id, name, questions, is_active, access_code)
       VALUES (gen_random_uuid(), $1, $2::jsonb, true, $3)
       RETURNING id`,
      [name, JSON.stringify(questions), accessCode]
    );

    await pool.query('COMMIT');

    const examId = rows[0]?.id;
    return res.status(200).json({
      ok: true,
      examId,
      saved: questions.length
    });
  } catch (err) {
    console.error('[exams/set] ERROR', err);
    try { await pool.query('ROLLBACK'); } catch {}

    return res
      .status(500)
      .json({ ok: false, error: 'Error de servidor al guardar el examen' });
  }
}