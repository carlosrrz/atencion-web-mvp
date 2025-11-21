// api/attempt/get.js
export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) return new Response(JSON.stringify({ ok:false, error:'id requerido' }), { status: 400 });

    const repo = getAttemptRepo();
    const attempt = await repo.getById(id); // debe incluir 'evidences' del SELECT
    if (!attempt) return Response.json({ ok:false, error:'no encontrado' }, { status: 404 });

    return Response.json({ ok:true, attempt });
  } catch (e) {
    return new Response(JSON.stringify({ ok:false, error:String(e?.message||e)}), { status: 500 });
  }
}
