import { AttemptRepository } from '../../domain/repositories/AttemptRepository.js';
import { pool } from '../../../lib/db.js';

export class PostgresAttemptRepository extends AttemptRepository {
  // infra/db/PostgresAttemptRepository.js (fragmento)
async save(a) {
  await this.db.query(
    `INSERT INTO attempts
     (id, student, started_at, ended_at, duration_ms, summary, exam, evidences)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (id) DO UPDATE SET
       student=$2, started_at=$3, ended_at=$4, duration_ms=$5, summary=$6, exam=$7, evidences=$8`,
    [
      a.id,
      JSON.stringify(a.student),
      a.startedAt, a.endedAt,
      a.durationMs,
      JSON.stringify(a.summary),
      JSON.stringify(a.exam),
      JSON.stringify(a.evidences ?? [])
    ]
  );
}

async getById(id){
  const { rows } = await this.db.query(
    `SELECT id, student, started_at, ended_at, duration_ms, summary, exam, evidences
       FROM attempts WHERE id=$1`, [id]
  );
  if (!rows.length) return null;
  const r = rows[0];
  return {
    id: r.id,
    student: r.student,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    durationMs: r.duration_ms,
    summary: r.summary,
    exam: r.exam,
    evidences: r.evidences || []
  };
}

}
