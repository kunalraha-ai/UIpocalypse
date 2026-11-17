// Fixture: write endpoint with NO auth check (unauth-write-route positive).
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  return Response.json({ ok: true, body });
}
