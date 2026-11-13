import { getSessionUser } from '@/lib/session';
import { placeOrder } from '@/lib/store';

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: 'Not signed in' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const order = await placeOrder(user.id, Number(body.total ?? 42), body.couponCode ?? null);
  return Response.json({ orderId: order.id, total: order.total });
}
