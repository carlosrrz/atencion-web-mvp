// api/attempt/get.js
import { getAttemptById } from '../../src/repositories/AttemptRepository.js';

export default async function handler(req, res) {
  try {
    const { id } = req.query;
    if (!id) return res.status(400).json({ ok:false, error:'id_required' });

    const item = await getAttemptById(String(id));
    if (!item) return res.status(404).json({ ok:false, error:'not_found' });

    res.json({ ok:true, item });
  } catch (e) {
    console.error('[attempt/get]', e);
    res.status(500).json({ ok:false, error:'server_error' });
  }
}
