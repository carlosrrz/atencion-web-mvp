import { getUserFromReq } from '../../lib/auth.js';
export default async function handler(req, res) {
  const user = getUserFromReq(req);
  if (!user) return res.status(200).json({ ok:false, user:null });
  return res.status(200).json({ ok:true, user });
}
