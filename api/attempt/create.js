// /api/attempt/create.js
import { getPool } from '../../lib/db.js';

function num(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}
function ts(v) {
  // acepta Date.now(), ISO, o ya Date
  try {
    if (!v) return null;
    if (v instanceof Date) return v;
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  } catch { return null; }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok:false, error:'Method not allowed' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } 
    catch { return res.status(400).json({ ok:false, error:'JSON inválido' }); }
  }

  try {
    // ---- 1) Validar estudiante ----
    const student = body.student || {};
    const name  = (student.name || '').trim();
    const code  = (student.code || '').trim();
    const email = (student.email || null);

    if (!name || !code) {
      return res.status(400).json({ ok:false, error:'Faltan nombre y/o código del estudiante' });
    }

    // ---- 2) Normalizar resumen / métricas ----
    const sum  = body.summary || {};
    const ta   = sum.tab_activity || {};
    const att  = sum.attention     || {};
    const occ  = sum.occlusion     || {};
    const lip  = sum.lips          || {};
    const perf = sum.performance   || {};

    // aceptar exam:{score,total} o exam:{correct,total}
    const ex    = body.exam || {};
    const exScore = num(ex.score != null ? ex.score : ex.correct, null);
    const exTotal = num(ex.total, null);

    const startedAt = ts(body.startedAt) || new Date();
    const endedAt   = ts(body.endedAt)   || new Date();
    const duration  = num(body.durationMs);

    // ---- 3) DB ----
    const pool = getPool();
    await pool.query('BEGIN');

    // 3a) Obtener/crear student
    let studentId;
    {
      const q1 = await pool.query(
        'SELECT id FROM students WHERE code = $1 LIMIT 1',
        [code]
      );
      if (q1.rows.length) {
        studentId = q1.rows[0].id;
        // actualizar nombre/email por si cambian
        await pool.query(
          'UPDATE students SET name=$1, email=$2 WHERE id=$3',
          [name, email, studentId]
        );
      } else {
        const q2 = await pool.query(
          'INSERT INTO students (id, code, name, email) VALUES (gen_random_uuid(), $1, $2, $3) RETURNING id',
          [code, name, email]
        );
        studentId = q2.rows[0].id;
      }
    }

    // 3b) Insertar attempt
    const insertAttempt = `
      INSERT INTO attempts (
        id, student_id, started_at, ended_at, duration_ms,
        offtab_episodes, offtab_total_ms, offtab_longest_ms, offtab_threshold_ms,
        lookaway_episodes, lookaway_total_ms, lookaway_longest_ms,
        occlusion_episodes, occlusion_total_ms,
        speak_episodes, speak_total_ms, speak_longest_ms,
        fps_median, latency_p95_ms, perf_overall,
        summary
      ) VALUES (
        gen_random_uuid(), $1, $2, $3, $4,
        $5, $6, $7, $8,
        $9, $10, $11,
        $12, $13,
        $14, $15, $16,
        $17, $18, $19,
        $20
      )
      RETURNING id
    `;

    const attemptSummary = {
      ...sum,
      exam: exTotal != null
        ? { score: exScore ?? null, total: exTotal }
        : undefined
    };

    const vals = [
      studentId,
      startedAt, endedAt, duration,
      num(ta.off_episodes), num(ta.off_total_ms), num(ta.off_longest_ms), num(ta.threshold_ms ?? ta.offThresholdMs ?? 1500),
      num(att.lookaway_episodes), num(att.lookaway_total_ms), num(att.lookaway_longest_ms),
      num(occ.episodes), num(occ.total_ms),
      num(lip.speak_episodes), num(lip.speak_total_ms), num(lip.speak_longest_ms),
      num(perf.fps_median), num(perf.latency_p95_ms ?? perf.p95), String(perf.perf_overall ?? perf.overall ?? ''),
      attemptSummary
    ];

    const a = await pool.query(insertAttempt, vals);
    const attemptId = a.rows[0].id;

    // 3c) Evidencias (acepta evidences[] o evidence[])
    const evidList = Array.isArray(body.evidences) ? body.evidences
                    : Array.isArray(body.evidence)  ? body.evidence
                    : [];
    for (const ev of evidList) {
      await pool.query(
        `INSERT INTO evidences (attempt_id, taken_at, kind, note, image_base64)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          attemptId,
          ts(ev.t) || new Date(),
          (ev.kind || 'alert').slice(0,60),
          ev.note || null,
          ev.data || null
        ]
      );
    }

    await pool.query('COMMIT');
    return res.status(200).json({ ok:true, attempt_id: attemptId });
  } catch (err) {
    try { await getPool().query('ROLLBACK'); } catch {}
    console.error('[attempt/create] ERROR:', err);
    return res.status(500).json({ ok:false, error: String(err.message || err) });
  }
}
// api/attempt/create.js (Route Handler de Next/Vercel)
export async function POST(req) {
  try {
    const body = await req.json();

    const attempt = {
      id: body.id,
      student: body.student,
      startedAt: body.startedAt,
      endedAt: body.endedAt,
      durationMs: body.durationMs,
      summary: body.summary,
      exam: body.exam ?? null,
      evidences: Array.isArray(body.evidences) ? body.evidences.slice(-24) :
                 Array.isArray(body.evidence)  ? body.evidence.slice(-24)  : [] // <- acepta ambas
    };

    // guarda en DB (usa tu repo)
    const repo = getAttemptRepo(); // tu fábrica
    await repo.save(attempt);

    return Response.json({ ok: true, id: attempt.id });
  } catch (e) {
    return new Response(JSON.stringify({ ok:false, error: String(e?.message || e)}), { status: 500 });
  }
}
