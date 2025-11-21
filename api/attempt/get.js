// api/attempt/get.js
import { getPool } from '../../lib/db.js';  // ajusta si tu helper se llama distinto

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ ok:false, error:'Method not allowed' });
  }
  try {
    const id = req.query?.id;
    if (!id) return res.status(400).json({ ok:false, error:'Falta id' });

    const pool = getPool();

    // Datos del intento + alumno + examen
    const { rows } = await pool.query(
      `SELECT a.id,
              a.started_at, a.ended_at, a.duration_ms,
              a.summary, a.fps_median, a.latency_p95_ms, a.perf_overall,
              s.name  AS student_name,
              s.code  AS student_code,
              s.email AS student_email,
              ea.correct, ea.total
         FROM attempts a
         JOIN students s     ON s.id = a.student_id
    LEFT JOIN exam_attempts ea ON ea.attempt_id = a.id
        WHERE a.id = $1
        LIMIT 1`,
      [id]
    );

    if (!rows.length) {
      return res.status(404).json({ ok:false, error:'Intento no encontrado' });
    }
    const r = rows[0];

    // Evidencias
    const ev = await pool.query(
      `SELECT taken_at, kind, note, image_base64
         FROM evidences
        WHERE attempt_id = $1
        ORDER BY taken_at ASC`,
      [id]
    );

    const evidences = ev.rows.map(e => {
  let data = e.image_base64 || null;

  // Si en BD está solo el base64 → le ponemos prefijo.
  // Si ya viene como "data:image/..." → lo dejamos tal cual.
  if (data && !String(data).startsWith('data:')) {
    data = `data:image/jpeg;base64,${data}`;
  }

  return {
    t: e.taken_at,
    kind: e.kind,
    note: e.note || '',
    data
  };
});


    const attempt = {
      id: r.id,
      startedAt: r.started_at,
      endedAt:   r.ended_at,
      durationMs: r.duration_ms,
      student: {
        name:  r.student_name,
        code:  r.student_code,
        email: r.student_email
      },
      summary: r.summary,
      exam: (r.correct != null && r.total != null) ? { correct: r.correct, total: r.total } : null,
      evidences
    };

    return res.status(200).json({ ok:true, attempt, evidences: evidences.length });
  } catch (err) {
    console.error('[attempt/get] ERROR', err);
    return res.status(500).json({ ok:false, error:'Server error' });
  }
}
