// api/attempt/list.js
import { getPool } from '../../lib/db.js';

export default async function handler(req, res) {
  try {
    const limit = Math.min(parseInt(req.query.limit ?? '200', 10) || 200, 500);
    const pool = getPool();

    // Ajusta nombres si tu esquema difiere
    const { rows } = await pool.query(`
      SELECT
        a.id,
        s.name   AS student_name,
        s.code   AS student_code,
        a.started_at,
        a.ended_at,
        a.duration_ms,
        a.offtab_episodes,
        a.lookaway_episodes,
        a.speak_episodes,
        COALESCE(
          jsonb_build_object(
            'off_episodes', a.offtab_episodes,
            'lookaway_episodes', a.lookaway_episodes,
            'speak_episodes', a.speak_episodes
          ),
          '{}'::jsonb
        ) AS summary,
        COALESCE(
          jsonb_build_object(
            'score', ea.correct,
            'total', ea.total
          ),
          '{}'::jsonb
        ) AS exam
      FROM attempts a
      LEFT JOIN students s    ON s.id = a.student_id
      LEFT JOIN exam_attempts ea ON ea.attempt_id = a.id
      ORDER BY a.created_at DESC
      LIMIT $1
    `, [limit]);

    // Normalizamos el shape que usa tu front
    const items = rows.map(r => ({
      id: r.id,
      student: { name: r.student_name, code: r.student_code },
      startedAt: r.started_at,
      endedAt:   r.ended_at,
      durationMs: r.duration_ms,
      summary: r.summary,
      exam: r.exam
    }));

    return res.status(200).json({ ok: true, items });
  } catch (err) {
    console.error('[api/attempt/list]', err);
    return res.status(500).json({ ok:false, error:'List attempts failed' });
  }
}

// api/attempt/list.js
export async function GET(req) {
  const repo = getAttemptRepo();
  const items = await repo.list({ limit: 200 });

  // por performance NO enviamos evidencias aquí
  const lite = items.map(a => {
    const { evidences, evidence, ...rest } = a;
    return rest;
  });

  return Response.json({ ok:true, items: lite });
}
