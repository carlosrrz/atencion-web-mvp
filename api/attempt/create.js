// /api/attempt/create.js
import { tx } from '../lib/db.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Method Not Allowed' });
    return;
  }

  try {
    const a = req.body || {};

    const exam = a.exam || {};
    const s = a.summary || {};
    const ta = s.tab_activity || {};
    const att = s.attention || {};
    const lip = s.lips || {};

    const evids = Array.isArray(a.evidences)
      ? a.evidences
      : (Array.isArray(a.evidence) ? a.evidence : []);

    const result = await tx(async (client) => {
      // Inserta intento (id se genera en la BD)
      const insAttempt = await client.query(
        `
        INSERT INTO attempts (
          student_name, student_code, student_email,
          started_at, ended_at, duration_ms,
          offtab_episodes, lookaway_episodes, speak_episodes
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        RETURNING id
        `,
        [
          a.student?.name ?? null,
          a.student?.code ?? null,
          a.student?.email ?? null,
          a.startedAt ?? a.startedAtISO ?? null,
          a.endedAt ?? null,
          a.durationMs ?? Math.round(s.duration_ms ?? 0),
          ta.off_episodes ?? 0,
          att.lookaway_episodes ?? 0,
          lip.speak_episodes ?? 0,
        ]
      );

      const attemptId = insAttempt.rows[0].id;

      // Examen (opcional)
      const correct = (exam.correct ?? exam.score ?? null);
      const total   = (exam.total ?? null);
      if (correct != null && total != null) {
        await client.query(
          `INSERT INTO exam_attempts (attempt_id, correct, total) VALUES ($1,$2,$3)`,
          [attemptId, correct, total]
        );
      }

      // Evidencias (opcional, recorta a 24 para no exceder payload)
      const items = evids.slice(0, 24);
      for (const it of items) {
        await client.query(
          `
          INSERT INTO evidences (attempt_id, kind, data, t, note)
          VALUES ($1,$2,$3,$4,$5)
          `,
          [
            attemptId,
            it.kind ?? null,
            it.data ?? null,                                  // base64
            it.t ? new Date(it.t).toISOString() : null,       // ms → ISO
            it.note ?? null
          ]
        );
      }

      return attemptId;
    });

    res.status(200).json({ ok: true, id: result });
  } catch (err) {
    console.error('[api/attempt/create] error', err);
    res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
}
