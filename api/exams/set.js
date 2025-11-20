// api/exam/set.js
import { getPool } from '../../lib/db.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok:false, error:'Method not allowed' });
  }
  try {
    const { name = 'Examen', questions = [] } = req.body || {};
    if (!Array.isArray(questions) || questions.length === 0) {
      return res.status(400).json({ ok:false, error:'questions vacío' });
    }

    const pool = getPool();

    // Tablas mínimas para banco/activación
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
      insert into current_exam(id, name) values (1, '—')
      on conflict (id) do nothing;
    `);

    const { rows } = await pool.query(
      `insert into exam_banks(name, payload) values ($1, $2) returning id`,
      [name, JSON.stringify(questions)]
    );
    const bankId = rows[0].id;

    await pool.query(
      `update current_exam set bank_id=$1, name=$2, activated_at=now() where id=1`,
      [bankId, name]
    );

    return res.status(200).json({ ok:true, id:bankId, saved: questions.length });
  } catch (err) {
    console.error('[exam/set]', err);
    return res.status(500).json({ ok:false, error:'Server error' });
  }
}
