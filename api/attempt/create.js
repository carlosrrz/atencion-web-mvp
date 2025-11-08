export const config = { runtime: 'edge' };
import { sql } from '../../lib/db.js';

function num(v, d = 0) { return Number.isFinite(+v) ? +v : d; }

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const body = await req.json();

    // ---- payload esperado desde el frontend ----
    // {
    //   student: { name, code, email },
    //   startedAt, endedAt, durationMs,
    //   summary: {...},  exam: { correct|score, total },
    //   evidences: [{ t, kind, note, data }, ...]   // máx ~24
    // }

    const stu = body.student || {};
    const sum = body.summary || {};
    const ta  = sum.tab_activity || {};
    const att = sum.attention     || {};
    const occ = sum.occlusion     || {};
    const lip = sum.lips          || {};
    const perf= sum.performance   || {};

    // 1) upsert estudiante por code
    const srows = await sql`
      INSERT INTO students (code, name, email)
      VALUES (${stu.code || ''}, ${stu.name || ''}, ${stu.email || null})
      ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, email = EXCLUDED.email
      RETURNING id
    `;
    const studentId = srows[0].id;

    // 2) attempt + resumen
    const arows = await sql`
      INSERT INTO attempts (
        student_id, started_at, ended_at, duration_ms,
        offtab_episodes, offtab_total_ms, offtab_longest_ms, offtab_threshold_ms,
        lookaway_episodes, lookaway_total_ms, lookaway_longest_ms,
        occlusion_episodes, occlusion_total_ms,
        speak_episodes, speak_total_ms, speak_longest_ms,
        fps_median, latency_p95_ms, perf_overall, summary
      ) VALUES (
        ${studentId},
        ${new Date(body.startedAt || Date.now() - num(sum.duration_ms,0)).toISOString()},
        ${new Date(body.endedAt   || Date.now()).toISOString()},
        ${num(body.durationMs || sum.duration_ms, 0)},

        ${num(ta.off_episodes, 0)}, ${num(ta.off_total_ms, 0)}, ${num(ta.off_longest_ms, 0)},
        ${num(ta.threshold_ms ?? ta.offThresholdMs, 1500)},

        ${num(att.lookaway_episodes, 0)}, ${num(att.lookaway_total_ms, 0)}, ${num(att.lookaway_longest_ms, 0)},

        ${num(occ.episodes, 0)}, ${num(occ.total_ms, 0)},

        ${num(lip.speak_episodes, 0)}, ${num(lip.speak_total_ms, 0)}, ${num(lip.speak_longest_ms, 0)},

        ${perf.fps_median ?? null}, ${perf.latency_p95_ms ?? null}, ${perf.overall ?? null},
        ${JSON.stringify(sum)}::jsonb
      )
      RETURNING id
    `;
    const attemptId = arows[0].id;

    // 3) examen (si vino)
    const exam = body.exam || {};
    const correct = (exam.correct ?? exam.score);
    const total   = (exam.total);
    if (Number.isFinite(+correct) && Number.isFinite(+total)) {
      await sql`
        INSERT INTO exam_attempts (attempt_id, correct, total, answers)
        VALUES (${attemptId}, ${+correct}, ${+total}, ${JSON.stringify(exam.answers||null)}::jsonb)
      `;
    }

    // 4) evidencias (bulk simple; si son muchas, se insertan en bucle)
    const ev = Array.isArray(body.evidences) ? body.evidences : [];
    for (const it of ev) {
      await sql`
        INSERT INTO evidences (attempt_id, taken_at, kind, note, image_base64)
        VALUES (
          ${attemptId},
          ${new Date(it.t || Date.now()).toISOString()},
          ${it.kind || 'evidence'},
          ${it.note || ''},
          ${it.data || null}
        )
      `;
    }

    return new Response(JSON.stringify({ ok: true, attemptId }), {
      headers: { 'content-type': 'application/json' }
    });

  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ ok:false, error: String(err) }), {
      status: 500, headers: { 'content-type': 'application/json' }
    });
  }
}
