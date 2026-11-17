// Fixture: Vercel serverless catch-all (api/v1/[...path].ts) — every
// /api/v1/* fetch must resolve to this route and never fire missing-endpoint.
// The write handler carries an auth signal (a real catch-all would verify
// the session before writing — keeps unauth-write-route scoped to its
// dedicated fixture).
export async function GET(): Promise<Response> {
  return Response.json({ ok: true });
}

export async function POST(req: Request): Promise<Response> {
  const user = await getUser(req);
  if (!user) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }
  return Response.json({ ok: true });
}

async function getUser(req: Request) {
  return req.headers.get('authorization') ? { id: 'u1' } : null;
}
