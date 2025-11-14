import { Attempt } from '../../domain/entities/Attempt.js';

export async function saveAttempt(payload, repo) {
  const attempt = Attempt.fromClientPayload(payload);
  return await repo.save(attempt); // { attemptId }
}
