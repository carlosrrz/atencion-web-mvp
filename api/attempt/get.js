// api/attempt/get.js
import { PostgresAttemptRepository } from '../../src/infra/db/PostgresAttemptRepository.js'; // ajusta ruta
import { getDb } from '../../lib/db.js'; // ajusta ruta

export default async function handler(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const id = url.searchParams.get('id');
    if (!id) return res.status(400).json({ ok:false, error:'id requerido' });

    const db = await getDb();
    const repo = new PostgresAttemptRepository(db);
    const attempt = await repo.findById(id); // implementa este método si no existe
    if (!attempt) return res.status(404).json({ ok:false, error:'not_found' });

    res.status(200).json({ ok:true, attempt });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok:false, error:'server_error' });
  }
}
