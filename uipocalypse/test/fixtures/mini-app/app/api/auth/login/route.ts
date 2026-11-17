// Fixture: a bare auth endpoint (no protection of any kind).
export async function POST(req: Request) {
  const { email, password } = await req.json().catch(() => ({}));
  return Response.json({ email, ok: !!password });
}
