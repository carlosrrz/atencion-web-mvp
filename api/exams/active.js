import { pool } from '../../lib/db.js';

export default async function handler(req, res) {
  const { rows:[ex] } = await pool.query('SELECT id,name,questions FROM exams WHERE is_active=true ORDER BY created_at DESC LIMIT 1');
  if (!ex) return res.status(200).json({ ok:false, exam:null });
  return res.status(200).json({ ok:true, exam: ex });
}
