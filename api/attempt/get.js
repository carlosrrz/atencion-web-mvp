// /api/attempt/get.js
import { pool } from '../../lib/db.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ ok:false, error:'METHOD_NOT_ALLOWED' });

  try {
    const id = req.query.id;
    if (!id) return res.status(400).json({ ok:false, error:'MISSING_ID' });

    // Attempt base
    const aQ = `
      SELECT a.id, a.started_at, a.ended_at, a.duration_ms, a.summary,
             s.name AS student_name, s.code AS student_code, s.email AS student_email
      FROM attempts a
      JOIN students s ON s.id = a.student_id
      WHERE a.id = $1
    `;
    const a = (await pool.query(aQ, [id])).rows[0];
    if (!a) return res.status(404).json({ ok:false, error:'NOT_FOUND' });

    // Evidences
    const eQ = `
      SELECT taken_at, kind, note, image_base64
      FROM evidences
      WHERE attempt_id = $1
      ORDER BY taken_at ASC
    `;
    const ev = (await pool.query(eQ, [id])).rows.map(r => {
      const src = r.image_base64
        ? (r.image_base64.startsWith('data:')
            ? r.image_base64
            : `data:image/jpeg;base64,${r.image_base64}`)
        : null;
      return {
        t: r.taken_at,
        kind: r.kind,
        note: r.note,
        data: src
      };
    });

    // Exam (opcional)
    const xQ = `
      SELECT correct, total, answers
      FROM exam_attempts
      WHERE attempt_id = $1
      LIMIT 1
    `;
    const xR = await pool.query(xQ, [id]);
    const exam = xR.rows[0] ? {
      correct: xR.rows[0].correct,
      total:   xR.rows[0].total,
      answers: xR.rows[0].answers
    } : null;

    return res.status(200).json({
      ok: true,
      attempt: {
        id: a.id,
        startedAt: a.started_at,
        endedAt: a.ended_at,
        durationMs: a.duration_ms,
        summary: a.summary,
        student: { name: a.student_name, code: a.student_code, email: a.student_email },
        exam,
        evidences: ev
      }
    });
  } catch (err) {
    console.error('[attempt/get] error', err);
    return res.status(500).json({ ok:false, error:'SERVER_ERROR' });
  }
}
