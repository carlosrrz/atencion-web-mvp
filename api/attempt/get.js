// api/attempt/get.js
import { getAttemptById } from '../../src/repositories/AttemptRepository.js'; 
// ajusta la ruta a tu repo real

export default async function handler(req, res) {
  try {
    const { id } = req.query;
    if (!id) return res.status(400).json({ ok:false, error:'id requerido' });

    const item = await getAttemptById(id);   // debe devolver { ... , evidences: [...] }
    if (!item) return res.status(404).json({ ok:false, error:'no encontrado' });

    res.json({ ok:true, item });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok:false, error:'server_error' });
  }
}
