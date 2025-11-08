// api/attempt/create.js
import { pool } from '../../lib/db.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  try {
    const body = req.body ?? JSON.parse(req.rawBody?.toString() || '{}'); // safety
    if (!body?.id) {
      res.status(400).json({ error: 'Missing attempt payload' });
      return;
    }

    const a = body;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO attempts
         (id, student_name, student_code, started_at, ended_at, duration_ms,
          offtab_episodes, lookaway_episodes, speak_episodes, exam_correct, exam_total)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (id) DO NOTHING`,
        [
          a.id, a.student?.name || null, a.student?.code || null,
          a.startedAt, a.endedAt, a.durationMs ?? 0,
          a.summary?.tab_activity?.off_episodes ?? 0,
          a.summary?.attention?.lookaway_episodes ?? 0,
          a.summary?.lips?.speak_episodes ?? 0,
          a.exam?.correct ?? a.exam?.score ?? 0,
          a.exam?.total ?? 0
        ]
      );

      const evids = Array.isArray(a.evidences) ? a.evidences.slice(0, 24) : [];
      for (const ev of evids) {
        await client.query(
          `INSERT INTO evidences (attempt_id, t, kind, note, data)
           VALUES ($1,$2,$3,$4,$5)`,
          [a.id, ev.t || new Date().toISOString(), ev.kind || null, ev.note || null, ev.data || null]
        );
      }
      await client.query('COMMIT');

      res.status(200).json({ ok: true, id: a.id, ev: evids.length });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message || String(err) });
  }
}
