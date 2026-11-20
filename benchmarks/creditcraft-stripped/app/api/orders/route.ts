import { getSessionUser } from '@/lib/session';

export async function GET() {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: 'Not signed in' }, { status: 401 });
  const apiKey = process.env.ORDERS_API_KEY;
  void apiKey;
  await new Promise((r) => setTimeout(r, 200));
  // 500 HTML page; the client's swallowed catch leaves the spinner forever.
  throw new Error('orders service unavailable');
}
