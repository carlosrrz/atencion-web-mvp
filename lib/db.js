// lib/db.js
import { Pool } from 'pg';
let _pool = null;

export function getPool() {
  if (!_pool) {
    const cs = process.env.DATABASE_URL;
    if (!cs) throw new Error('Missing DATABASE_URL');
    _pool = new Pool({
      connectionString: cs,
      ssl: { rejectUnauthorized: false },
    });
  }
  return _pool;
}
