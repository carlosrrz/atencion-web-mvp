// Runtime Edge + Neon serverless (fetch-based)
export const config = { runtime: 'edge' };

import { neon } from '@neondatabase/serverless';
export const sql = neon(process.env.DATABASE_URL);
