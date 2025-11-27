// /api/attempt/create.js
import { getPool } from '../../lib/db.js';
import { randomUUID } from 'crypto';

const clean = (s = '') =>
  String(s).normalize('NFKC').replace(/\s+/g, ' ').trim();

const NAME_RE =
  /^(?=.{2,60}$)[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+(?:[ '\-][A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+)*$/;

// solo números (ajusta el {1,32} si quieres mínimo/máximo)
const CODE_RE = /^\d{1,32}$/;

function num(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function toDate(v) {
  try {
    if (!v) return null;
    if (v instanceof Date) return v;
    const d = new Date(v);
    return Number.isFinite(d.getTime()) ? d : null;
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  // Body robusto (Vercel a veces manda string)
  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      return res.status(400).json({ ok: false, error: 'JSON inválido' });
    }
  }
  body = body && typeof body === 'object' ? body : {};

  // ---- 1) Validar estudiante ----
  const student = body.student || {};
  const name = clean(student.name);
  const code = clean(student.code);
  const emailRaw = student.email == null ? null : clean(student.email);
  const email = emailRaw ? emailRaw.toLowerCase() : null;

  if (!name || !code) {
    return res.status(400).json({ ok: false, error: 'Faltan nombre y/o código del estudiante' });
  }
  if (!NAME_RE.test(name)) {
    return res.status(400).json({ ok: false, error: 'Nombre inválido' });
  }
  if (!CODE_RE.test(code)) {
    return res.status(400).json({ ok: false, error: 'Código inválido (solo números)' });
  }

  // ---- 2) Normalizar resumen / métricas (con defaults) ----
  const sum = body.summary || {};
  const ta = sum.tab_activity || {};
  const att = sum.attention || {};
  const occ = sum.occlusion || {};
  const lip = sum.lips || {};
  const perf = sum.performance || {};

  const ex = body.exam || {};
  const exScore = ex.score != null ? num(ex.score, null) : (ex.correct != null ? num(ex.correct, null) : null);
  const exTotal = ex.total != null ? num(ex.total, null) : null;

  const startedAt = toDate(body.startedAt) || new Date();
  const endedAt = toDate(body.endedAt) || new Date();
  const durationMs =
    body.durationMs != null ? num(body.durationMs, 0) : Math.max(0, endedAt.getTime() - startedAt.getTime());

  const attemptSummary = {
    ...sum,
    exam: exTotal != null ? { score: exScore ?? null, total: exTotal } : undefined,
  };

  // ---- 3) DB ----
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 3a) upsert student por code
    let studentId;
    const q1 = await client.query('SELECT id FROM students WHERE code = $1 LIMIT 1', [code]);

    if (q1.rowCount) {
      studentId = q1.rows[0].id;
      await client.query('UPDATE students SET name=$1, email=$2 WHERE id=$3', [name, email, studentId]);
    } else {
      studentId = randomUUID();
      await client.query(
        'INSERT INTO students (id, code, name, email) VALUES ($1, $2, $3, $4)',
        [studentId, code, name, email]
      );
    }

    // 3b) insertar attempt
    const attemptId = randomUUID();

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
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9,
        $10, $11, $12,
        $13, $14,
        $15, $16, $17,
        $18, $19, $20,
        $21
      )
    `;

    const vals = [
      attemptId,
      studentId,
      startedAt,
      endedAt,
      durationMs,

      num(ta.off_episodes),
      num(ta.off_total_ms),
      num(ta.off_longest_ms),
      num(ta.threshold_ms ?? ta.offThresholdMs ?? 1500),

      num(att.lookaway_episodes),
      num(att.lookaway_total_ms),
      num(att.lookaway_longest_ms),

      num(occ.episodes),
      num(occ.total_ms),

      num(lip.speak_episodes),
      num(lip.speak_total_ms),
      num(lip.speak_longest_ms),

      num(perf.fps_median),
      num(perf.latency_p95_ms ?? perf.p95),
      String(perf.perf_overall ?? perf.overall ?? ''),

      attemptSummary,
    ];

    await client.query(insertAttempt, vals);

    // 3c) evidences (acepta evidences[] o evidence[])
    const evidList = Array.isArray(body.evidences)
      ? body.evidences
      : Array.isArray(body.evidence)
        ? body.evidence
        : [];

    for (const ev of evidList) {
      await client.query(
        `INSERT INTO evidences (attempt_id, taken_at, kind, note, image_base64)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          attemptId,
          toDate(ev?.t) || new Date(),
          String(ev?.kind || 'alert').slice(0, 60),
          ev?.note || null,
          ev?.data || null,
        ]
      );
    }

    await client.query('COMMIT');

    // devuelvo ambos por compatibilidad con tu pytest
    return res.status(200).json({ ok: true, attempt_id: attemptId, id: attemptId });
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {}
    console.error('[attempt/create] ERROR:', err);
    return res.status(500).json({ ok: false, error: String(err?.message || err) });
  } finally {
    client.release();
  }
}
