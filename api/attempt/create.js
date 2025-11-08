// /api/attempt/create.js
import { pool } from '../../lib/db.js'; // <- cambia a ../lib/db.js si moviste db.js dentro de /api

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const body = req.body || {};
    const student = body.student || {};
    const summary = body.summary || {};
    const exam    = body.exam || null;
    const evids   = Array.isArray(body.evidences) ? body.evidences : [];

    const name  = (student.name || '').trim();
    const code  = (student.code || '').trim();
    const email = (student.email || '').trim();

    // 1) Upsert del estudiante (requiere UNIQUE en students.code)
    const stu = await client.query(
      `INSERT INTO students (code, name, email)
       VALUES ($1, $2, $3)
       ON CONFLICT (code) DO UPDATE
         SET name = EXCLUDED.name,
             email = EXCLUDED.email
       RETURNING id`,
      [code || null, name || null, email || null]
    );
    const studentId = stu.rows[0].id;

    // 2) Desglose de métricas del resumen
    const startedAt = summary.started_at || summary.startedAt || new Date().toISOString();
    const endedAt   = summary.ended_at   || summary.endedAt   || new Date().toISOString();
    const duration  = summary.duration_ms ?? summary.durationMs ?? null;

    const offEpisodes   = summary.tab_activity?.off_episodes ?? 0;
    const lookEpisodes  = summary.attention?.lookaway_episodes ?? 0;
    const speakEpisodes = summary.lips?.speak_episodes ?? 0;

    const fpsMedian = summary.performance?.fps_median ?? null;
    const p95ms     = summary.performance?.latency_p95_ms ?? null;

    // 3) Insert del intento
    const ins = await client.query(
      `INSERT INTO attempts
         (student_id, started_at, ended_at, duration_ms,
          offtab_episodes, lookaway_episodes, speak_episodes,
          fps_median, latency_p95_ms)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING id`,
      [studentId, startedAt, endedAt, duration,
       offEpisodes, lookEpisodes, speakEpisodes,
       fpsMedian, p95ms]
    );
    const attemptId = ins.rows[0].id;

    // 4) Resultados del examen (opcional)
    if (exam && exam.total != null && exam.correct != null) {
      await client.query(
        `INSERT INTO exam_attempts (attempt_id, correct, total)
         VALUES ($1,$2,$3)`,
        [attemptId, exam.correct, exam.total]
      );
    }

    // 5) Evidencias (opcional)
    if (evids.length) {
      for (const it of evids.slice(0, 100)) {
        // it.t viene en milisegundos; lo convertimos a timestamptz
        const tMs = Number(it.t ?? Date.now());
        await client.query(
            `INSERT INTO evidences (attempt_id, kind, taken_at, image_base64, note)
            VALUES ($1, $2, to_timestamp($3/1000.0), $4, $5)`,
            [
                attemptId,
                it.kind || null,
                tMs,
                it.data || null,   // base64 de la imagen
                it.note || null
            ]
        );

      }
    }

    await client.query('COMMIT');
    return res.status(200).json({ ok: true, id: attemptId });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[api/attempt/create] error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  } finally {
    client.release();
  }
}
