// src/repositories/AttemptRepository.js
import { pgSaveAttempt, pgGetAttemptById } from '../../infra/db/PostgresAttemptRepository.js';

export async function saveAttempt(a) {
  return pgSaveAttempt(a);
}

export async function getAttemptById(id) {
  return pgGetAttemptById(id);
}
