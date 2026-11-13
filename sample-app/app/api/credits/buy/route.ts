import { getSessionUser } from '@/lib/session';
import { buyCredits } from '@/lib/store';

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: 'Not signed in' }, { status: 401 });
  const { packId } = await req.json().catch(() => ({}));
  // Planted bug #4 (server side): every POST appends a transaction — no
  // idempotency key, so rapid double-clicks double-charge.
  const result = await buyCredits(user.id, String(packId ?? ''));
  return Response.json(result, { status: result.status });
}
