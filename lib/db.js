// lib/db.js
import { Pool } from 'pg';

let _pool;
export function getPool() {
  if (!_pool) {
    _pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    });
  }
  return _pool;
}

// opcional, para quien importe { pool }
export const pool = getPool();
