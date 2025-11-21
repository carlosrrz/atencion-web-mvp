// src/infra/db/PostgresAttemptRepository.js
import { AttemptRepository } from '../../domain/repositories/AttemptRepository.js';
import { pool } from '../../../lib/db.js';

/**
 * Normaliza un intento proveniente del front a un shape común para BD.
 * Acepta campos tanto del formato nuevo (app.js) como del antiguo.
 */
function normalizeAttempt(raw) {
  // tiempos
  const startedAt =
    raw.startedAt ??
    raw.timing?.startedAt ??
    raw.started_at ??
    new Date().toISOString();

  const endedAt =
    raw.endedAt ??
    raw.timing?.endedAt ??
    raw.ended_at ??
    new Date().toISOString();

  const durationMs =
    raw.durationMs ??
    raw.timing?.durationMs ??
    raw.summary?.duration_ms ??
    0;

  // student
  const student = {
    code:  raw.student?.code  ?? '',
    name:  raw.student?.name  ?? '',
    email: raw.student?.email ?? null,
  };

  // summary → métricas (compat)
  const S     = raw.summary ?? {};
  const TAB   = S.tab_activity ?? {};
  const ATTN  = S.attention ?? {};
  const OCCL  = S.occlusion ?? {};
  const LIPS  = S.lips ?? {};
  const PERF  = S.performance ?? {};
  const m = {
    offtab: {
      episodes:   TAB.off_episodes   ?? TAB.episodes   ?? 0,
      totalMs:    TAB.off_total_ms   ?? TAB.total_ms   ?? 0,
      longestMs:  TAB.longest_off_ms ?? TAB.longest_ms ?? 0,
      thresholdMs:TAB.threshold_ms   ?? 2000,
    },
    lookaway: {
      episodes:   ATTN.lookaway_episodes   ?? 0,
      totalMs:    ATTN.lookaway_total_ms   ?? 0,
      longestMs:  ATTN.lookaway_longest_ms ?? 0,
    },
    occlusion: {
      episodes:   OCCL.episodes   ?? 0,
      totalMs:    OCCL.total_ms   ?? 0,
      longestMs:  OCCL.longest_ms ?? 0,
    },
    speak: {
      episodes:   LIPS.speak_episodes   ?? 0,
      totalMs:    LIPS.speak_total_ms   ?? 0,
      longestMs:  LIPS.speak_longest_ms ?? 0,
    },
    perf: {
      fpsMedian:    PERF.fps_median      ?? null,
      latencyP95Ms: PERF.latency_p95_ms  ?? null,
      overall:      PERF.overall         ?? null,
    },
  };

  // examen
  const exam = raw.exam
    ? {
        correct: Number(raw.exam.correct ?? raw.exam.score ?? 0),
        total:   Number(raw.exam.total   ?? 0),
        answers: raw.exam.answers ?? null,
      }
    : null;

  // evidencias (acepta dataURL o image_base64, y t o taken_at)
  const evArr = Array.isArray(raw.evidences)
    ? raw.evidences
    : (Array.isArray(raw.evidence) ? raw.evidence : []);

  const evidences = evArr.map(ev => ({
    takenAt:
      ev.takenAt ??
      ev.taken_at ??
      (typeof ev.t === 'number' ? new Date(ev.t).toISOString() : ev.t) ??
      new Date().toISOString(),
    kind:  ev.kind ?? 'alert',
    note:  ev.note ?? null,
    imageBase64: ev.imageBase64 ?? ev.image_base64 ?? ev.data ?? null, // dataURL
  }));

  return {
    student,
    startedAt,
    endedAt,
    durationMs,
    summary: S || null,
    metrics: m,
    exam,
    evidences,
  };
}

export class PostgresAttemptRepository extends AttemptRepository {
  async save(attemptRaw) {
    const client = await pool.connect();
    const attempt = normalizeAttempt(attemptRaw);

    try {
      await client.query('BEGIN');

      // 1) Upsert del estudiante
      const sRes = await client.query(
        `INSERT INTO students (code, name, email)
         VALUES ($1,$2,$3)
         ON CONFLICT (code) DO UPDATE
           SET name=EXCLUDED.name, email=EXCLUDED.email
         RETURNING id;`,
        [attempt.student.code, attempt.student.name, attempt.student.email]
      );
      const studentId = sRes.rows[0].id;

      // 2) Insert del attempt (id lo genera la BD)
      const m = attempt.metrics || {}, perf = m.perf || {};
      const aRes = await client.query(
        `INSERT INTO attempts (
           id, student_id, started_at, ended_at, duration_ms,
           offtab_episodes, offtab_total_ms, offtab_longest_ms, offtab_threshold_ms,
           lookaway_episodes, lookaway_total_ms, lookaway_longest_ms,
           occlusion_episodes, occlusion_total_ms, occlusion_longest_ms,
           speak_episodes, speak_total_ms, speak_longest_ms,
           fps_median, latency_p95_ms, perf_overall, summary
         ) VALUES (
           gen_random_uuid(), $1, $2, $3, $4,
           $5,$6,$7,$8,
           $9,$10,$11,
           $12,$13,$14,
           $15,$16,$17,
           $18,$19,$20,$21
         ) RETURNING id;`,
        [
          studentId,
          attempt.startedAt, attempt.endedAt, attempt.durationMs,

          m.offtab?.episodes   ?? 0,
          m.offtab?.totalMs    ?? 0,
          m.offtab?.longestMs  ?? 0,
          m.offtab?.thresholdMs?? 2000,

          m.lookaway?.episodes ?? 0,
          m.lookaway?.totalMs  ?? 0,
          m.lookaway?.longestMs?? 0,

          m.occlusion?.episodes ?? 0,
          m.occlusion?.totalMs  ?? 0,
          m.occlusion?.longestMs?? 0,

          m.speak?.episodes    ?? 0,
          m.speak?.totalMs     ?? 0,
          m.speak?.longestMs   ?? 0,

          perf.fpsMedian ?? null,
          perf.latencyP95Ms ?? null,
          perf.overall ?? null,

          attempt.summary ? JSON.stringify(attempt.summary) : null
        ]
      );
      const attemptId = aRes.rows[0].id;

      // 3) Examen (si existe)
      if (attempt.exam && (Number.isFinite(attempt.exam.total) || Number.isFinite(attempt.exam.correct))) {
        await client.query(
          `INSERT INTO exam_attempts (id, attempt_id, correct, total, answers)
           VALUES (gen_random_uuid(), $1, $2, $3, $4)`,
          [
            attemptId,
            attempt.exam.correct ?? null,
            attempt.exam.total ?? null,
            attempt.exam.answers ? JSON.stringify(attempt.exam.answers) : null
          ]
        );
      }

      // 4) Evidencias (opcional)
      if (attempt.evidences?.length) {
        const evSql = `INSERT INTO evidences (id, attempt_id, taken_at, kind, note, image_base64)
                       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5)`;
        for (const ev of attempt.evidences) {
          await client.query(evSql, [
            attemptId,
            ev.takenAt ?? new Date().toISOString(),
            ev.kind ?? 'alert',
            ev.note ?? null,
            ev.imageBase64 ?? null
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
