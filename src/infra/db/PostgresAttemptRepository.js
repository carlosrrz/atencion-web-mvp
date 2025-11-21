// infra/db/PostgresAttemptRepository.js
import { pool } from '../../lib/db.js';

export async function pgSaveAttempt(a) {
  const {
    id, student, startedAt, endedAt, durationMs, summary, exam, evidences
  } = a;

  const q = `
    INSERT INTO attempts
      (id, student_name, student_code, student_email, started_at, ended_at, duration_ms, summary, exam, evidences)
    VALUES
      ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb)
    ON CONFLICT (id) DO UPDATE SET
      student_name = EXCLUDED.student_name,
      student_code = EXCLUDED.student_code,
      student_email= EXCLUDED.student_email,
      started_at   = EXCLUDED.started_at,
      ended_at     = EXCLUDED.ended_at,
      duration_ms  = EXCLUDED.duration_ms,
      summary      = EXCLUDED.summary,
      exam         = EXCLUDED.exam,
      evidences    = EXCLUDED.evidences
  `;
  const params = [
    id,
    student?.name || '',
    student?.code || '',
    student?.email || '',
    startedAt,
    endedAt,
    durationMs || 0,
    JSON.stringify(summary || {}),
    JSON.stringify(exam || null),
    JSON.stringify(Array.isArray(evidences) ? evidences : [])
  ];
  await pool.query(q, params);
}

export async function pgGetAttemptById(id) {
  const r = await pool.query(
    `SELECT id, student_name, student_code, student_email, started_at, ended_at, duration_ms,
            summary, exam, evidences
       FROM attempts
      WHERE id = $1
      LIMIT 1`, [id]
  );
  if (!r.rows.length) return null;
  const row = r.rows[0];
  return {
    id: row.id,
    student: {
      name: row.student_name,
      code: row.student_code,
      email: row.student_email
    },
    startedAt: row.started_at,
    endedAt: row.ended_at,
    durationMs: row.duration_ms,
    summary: row.summary,
    exam: row.exam,
    evidences: row.evidences || []
  };
}

// (si ya tienes list con summary, déjalo como está; no envíes evidences ahí)

