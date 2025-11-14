// api/attempt/create.js
import { PostgresAttemptRepository } from '../../src/infra/db/PostgresAttemptRepository.js';
import { saveAttempt } from '../../src/app/usecases/saveAttempt.js';

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
    }
    const repo = new PostgresAttemptRepository();
    const { attemptId } = await saveAttempt(req.body, repo);
    return res.status(200).json({ ok: true, attemptId });
  } catch (err) {
    console.error('[attempt/create]', err);
    return res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
}
