// api/attempt/create.js
import { saveAttempt } from '../../src/repositories/AttemptRepository.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED' });
  }

  try {
    const body = req.body || {};
    const {
      id, student, startedAt, endedAt, durationMs, summary, exam, evidences
    } = body;

    if (!id || !startedAt || !endedAt || !summary) {
      return res.status(400).json({ ok: false, error: 'invalid_payload' });
    }

    // normaliza y recorta evidencias (máx 12)
    const safeEvidences = Array.isArray(evidences) ? evidences.slice(-12).map((e) => ({
      t:     e?.t || Date.now(),
      kind:  String(e?.kind || ''),
      note:  String(e?.note || ''),
      // ⚠️ IMPORTANTE: debe ser dataURL "data:image/jpeg;base64,...."
      data:  String(e?.data || '')
    })) : [];

    await saveAttempt({
      id,
      student: {
        name:  student?.name  || '',
        code:  student?.code  || '',
        email: student?.email || ''
      },
      startedAt,
      endedAt,
      durationMs: Number(durationMs || 0),
      summary,
      exam: exam || null,
      evidences: safeEvidences
    });

    res.json({ ok: true, id });
  } catch (e) {
    console.error('[attempt/create]', e);
    res.status(500).json({ ok: false, error: 'server_error' });
  }
}
