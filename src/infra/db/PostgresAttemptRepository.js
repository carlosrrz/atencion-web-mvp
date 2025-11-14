import { AttemptRepository } from '../../domain/repositories/AttemptRepository.js';
import { pool } from '../../../lib/db.js';

export class PostgresAttemptRepository extends AttemptRepository {
  async save(attempt) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const sRes = await client.query(
        `INSERT INTO students (code, name, email)
         VALUES ($1,$2,$3)
         ON CONFLICT (code) DO UPDATE
           SET name=EXCLUDED.name, email=EXCLUDED.email
         RETURNING id;`,
        [attempt.student.code, attempt.student.name, attempt.student.email]
      );
      const studentId = sRes.rows[0].id;

      const m = attempt.metrics || {}, perf = m.perf || {};
      const aRes = await client.query(
        `INSERT INTO attempts (
           id, student_id, started_at, ended_at, duration_ms,
           offtab_episodes, offtab_total_ms, offtab_longest_ms, offtab_threshold_ms,
           lookaway_episodes, lookaway_total_ms, lookaway_longest_ms,
           occlusion_episodes, occlusion_total_ms,
           speak_episodes, speak_total_ms, speak_longest_ms,
           fps_median, latency_p95_ms, perf_overall, summary
         ) VALUES (
           gen_random_uuid(), $1, $2, $3, $4,
           $5,$6,$7,$8,
           $9,$10,$11,
           $12,$13,
           $14,$15,$16,
           $17,$18,$19,$20
         ) RETURNING id;`,
        [
          studentId,
          attempt.timing.startedAt, attempt.timing.endedAt, attempt.timing.durationMs,
          m.offtab?.episodes ?? 0, m.offtab?.totalMs ?? 0, m.offtab?.longestMs ?? 0, m.offtab?.thresholdMs ?? 2000,
          m.lookaway?.episodes ?? 0, m.lookaway?.totalMs ?? 0, m.lookaway?.longestMs ?? 0,
          m.occlusion?.episodes ?? 0, m.occlusion?.totalMs ?? 0,
          m.speak?.episodes ?? 0, m.speak?.totalMs ?? 0, m.speak?.longestMs ?? 0,
          perf.fpsMedian ?? null, perf.latencyP95Ms ?? null, perf.overall ?? null,
          attempt.summary ? JSON.stringify(attempt.summary) : null
        ]
      );
      const attemptId = aRes.rows[0].id;

      await client.query(
        `INSERT INTO exam_attempts (id, attempt_id, correct, total, answers)
         VALUES (gen_random_uuid(), $1, $2, $3, $4)`,
        [attemptId, attempt.exam.correct, attempt.exam.total,
         attempt.exam.answers ? JSON.stringify(attempt.exam.answers) : null]
      );

      if (attempt.evidences?.length) {
        const evSql = `INSERT INTO evidences (attempt_id, taken_at, kind, note, image_base64)
                       VALUES ($1,$2,$3,$4,$5)`;
        for (const ev of attempt.evidences) {
          await client.query(evSql, [
            attemptId, ev.takenAt, ev.kind, ev.note ?? null, ev.imageBase64 ?? null
          ]);
        }
      }

      await client.query('COMMIT');
      return { attemptId };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }
}
