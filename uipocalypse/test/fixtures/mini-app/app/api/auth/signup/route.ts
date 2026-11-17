import { rateLimit } from '@/lib/limiter';

// Fixture: auth endpoint WITH rate limiting (no-rate-limit-auth negative).
export async function POST(req: Request) {
  const limited = await rateLimit(req);
  if (limited) return Response.json({ error: 'too many requests' }, { status: 429 });
  return Response.json({ ok: true });
}
