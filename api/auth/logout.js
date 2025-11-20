// /api/auth/logout.js
import { clearAuthCookie } from '../../lib/auth.js';

export default async function handler(req, res) {
  clearAuthCookie(res);
  res.status(200).json({ ok:true });
}

// api/auth/logout.js
export default function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }
  // Si usaras cookies, aquí las limpiarías (set-cookie expirado).
  return res.status(200).json({ ok: true });
}
