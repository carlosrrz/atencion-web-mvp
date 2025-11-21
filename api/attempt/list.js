// api/attempt/list.js
export async function GET(req) {
  const repo = getAttemptRepo();
  const items = await repo.list({ limit: 200 });

  // por performance NO enviamos evidencias aquí
  const lite = items.map(a => {
    const { evidences, evidence, ...rest } = a;
    return rest;
  });

  return Response.json({ ok:true, items: lite });
}
