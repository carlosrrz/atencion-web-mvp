// api/exams/set.js
import { getPool } from '../../lib/db.js';

// mismas reglas que en el front (encargado.html)
const EXAM_NAME_RE = /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ ]{3,60}$/;
const EXAM_CODE_RE = /^[0-9]{4,8}$/;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      return res.status(400).json({ ok: false, error: 'JSON inválido' });
    }
  }

  const rawName = (body?.name ?? '').trim();
  const rawCode = (body?.accessCode ?? '').toString().trim();
  const questions = Array.isArray(body?.questions) ? body.questions : [];

  if (!rawName) {
    return res.status(400).json({ ok: false, error: 'Falta nombre de examen' });
  }
  if (!EXAM_NAME_RE.test(rawName)) {
    return res.status(400).json({
      ok: false,
      error: 'Nombre de examen inválido (solo letras y espacios, 3–60 caracteres).'
    });
  }

  if (!rawCode) {
    return res.status(400).json({
      ok: false,
      error: 'Falta código de examen (4–8 dígitos).'
    });
  }
  if (!EXAM_CODE_RE.test(rawCode)) {
    return res.status(400).json({
      ok: false,
      error: 'Código de examen inválido (solo números, 4–8 dígitos).'
    });
  }

  if (!questions.length) {
    return res.status(400).json({
      ok: false,
      error: 'No se recibieron preguntas para el examen'
    });
  }

  try {
    const pool = getPool();

    // Desactiva otros exámenes activos (opcional pero recomendable)
    await pool.query('UPDATE exams SET is_active = FALSE WHERE is_active = TRUE');

    // Inserta nuevo examen con código y banco de preguntas
    await pool.query(
      `
      INSERT INTO exams (id, name, access_code, is_active, questions)
      VALUES (gen_random_uuid(), $1, $2, TRUE, $3)
      `,
      [rawName, rawCode, questions]
    );

    return res.status(200).json({
      ok: true,
      saved: questions.length
    });
  } catch (e) {
    console.error('[api/exams/set] ERROR', e);
    return res.status(500).json({ ok: false, error: 'Error de servidor' });
  }
}
