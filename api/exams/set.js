// api/exam/set.js
import { getPool } from '../../lib/db.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok:false, error:'Method not allowed' });
  }
  try {
    const { name, questions } = req.body || {};
    if (!name || !Array.isArray(questions) || !questions.length) {
      return res.status(400).json({ ok:false, error:'payload inválido' });
    }

    const pool = getPool();

    // Tabla para guardar el examen activo
    await pool.query(`
      CREATE TABLE IF NOT EXISTS exam_defs(
        id         text PRIMARY KEY,
        name       text NOT NULL,
        questions  jsonb NOT NULL,
        created_at timestamptz DEFAULT now()
      )
    `);

    // Guarda/actualiza el “examen activo”
    await pool.query(
      `INSERT INTO exam_defs (id, name, questions)
       VALUES ('active', $1, $2::jsonb)
       ON CONFLICT (id) DO UPDATE
       SET name = EXCLUDED.name, questions = EXCLUDED.questions, created_at = now()`,
      [name, JSON.stringify(questions)]
    );

    return res.status(200).json({ ok:true, saved: questions.length, name });
  } catch (err) {
    console.error('[exam/set] ERROR', err);
    return res.status(500).json({ ok:false, error:'server error' });
  }
}
