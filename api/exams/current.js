// api/exam/current.js
import { getPool } from '../../lib/db.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ ok:false, error:'Method not allowed' });
  }
  try {
    const pool = getPool();
    await pool.query(`
      create table if not exists exam_banks(
        id bigserial primary key,
        name text not null,
        payload jsonb not null,
        created_at timestamptz default now()
      );
      create table if not exists current_exam(
        id int primary key default 1,
        bank_id bigint references exam_banks(id),
        name text not null,
        activated_at timestamptz default now()
      );
    `);

    const { rows } = await pool.query(`
      select b.name, b.payload
      from current_exam c
      left join exam_banks b on b.id = c.bank_id
      where c.id = 1
    `);

    const row = rows[0];
    if (!row || !row.payload) {
      // sin examen activo → JSON válido
      return res.status(200).json({ ok:true, name:'—', questions: [] });
    }

    return res.status(200).json({ ok:true, name: row.name, questions: row.payload });
  } catch (err) {
    console.error('[exam/current]', err);
    return res.status(500).json({ ok:false, error:'Server error' });
  }
}
