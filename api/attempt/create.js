// api/attempt/create.js (Route Handler de Next/Vercel)
export async function POST(req) {
  try {
    const body = await req.json();

    const attempt = {
      id: body.id,
      student: body.student,
      startedAt: body.startedAt,
      endedAt: body.endedAt,
      durationMs: body.durationMs,
      summary: body.summary,
      exam: body.exam ?? null,
      evidences: Array.isArray(body.evidences) ? body.evidences.slice(-24) :
                 Array.isArray(body.evidence)  ? body.evidence.slice(-24)  : [] // <- acepta ambas
    };

    // guarda en DB (usa tu repo)
    const repo = getAttemptRepo(); // tu fábrica
    await repo.save(attempt);

    return Response.json({ ok: true, id: attempt.id });
  } catch (e) {
    return new Response(JSON.stringify({ ok:false, error: String(e?.message || e)}), { status: 500 });
  }
}
