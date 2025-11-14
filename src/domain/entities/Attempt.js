// src/domain/entities/Attempt.js
export class Attempt {
  constructor(props = {}) {
    const {
      id,
      studentId,
      startedAt,
      endedAt,
      durationMs = 0,
      offEpisodes = 0,
      lookawayEpisodes = 0,
      speakEpisodes = 0,
      summary = {},          // { exam:{correct,total}, ... }
      createdAt = new Date()
    } = props;

    if (!studentId) throw new Error('studentId requerido');

    this.id = id ?? (globalThis.crypto?.randomUUID?.() ?? null);
    this.studentId = studentId;

    this.startedAt = startedAt ? new Date(startedAt) : new Date();
    this.endedAt   = endedAt ? new Date(endedAt) : null;
    this.durationMs = Number(durationMs);

    this.offEpisodes = Number(offEpisodes);
    this.lookawayEpisodes = Number(lookawayEpisodes);
    this.speakEpisodes = Number(speakEpisodes);

    this.summary = summary;
    this.createdAt = createdAt instanceof Date ? createdAt : new Date(createdAt);
  }

  toPrimitives() {
    return {
      id: this.id,
      studentId: this.studentId,
      startedAt: this.startedAt,
      endedAt: this.endedAt,
      durationMs: this.durationMs,
      offEpisodes: this.offEpisodes,
      lookawayEpisodes: this.lookawayEpisodes,
      speakEpisodes: this.speakEpisodes,
      summary: this.summary,
      createdAt: this.createdAt
    };
  }
}
