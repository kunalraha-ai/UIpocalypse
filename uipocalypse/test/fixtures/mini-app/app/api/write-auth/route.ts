import { getSessionUser } from '@/lib/session';

// Fixture: write endpoint WITH an auth check (unauth-write-route negative).
export async function POST(_req: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });
  return Response.json({ ok: true });
}
