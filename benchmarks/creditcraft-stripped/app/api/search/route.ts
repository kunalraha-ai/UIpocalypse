import { NextRequest } from 'next/server';
import { products } from '@/lib/store';

// allowlist, so emoji/RTL input turns into a 500 instead of a graceful error.
function sanitize(q: string): string {
  for (const ch of q) {
    if (!/[a-zA-Z0-9 ,.'-]/u.test(ch)) {
      throw new Error(`Unsupported character in query: ${ch}`);
    }
  }
  return q.trim();
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q') ?? '';
  try {
    const clean = sanitize(q);
    const results = products
      .filter((p) => p.name.toLowerCase().includes(clean.toLowerCase()))
      .map((p) => p.name);
    await new Promise((r) => setTimeout(r, 100));
    return Response.json({ query: q, count: results.length, results });
  } catch {
    return Response.json({ error: 'Search failed' }, { status: 500 });
  }
}
