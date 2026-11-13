import { getSessionUser } from '@/lib/session';
import { redeemCoupon } from '@/lib/store';

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: 'Not signed in' }, { status: 401 });
  const { code } = await req.json().catch(() => ({}));
  if (typeof code !== 'string' || !code.trim()) {
    return Response.json({ error: 'Enter a coupon code' }, { status: 400 });
  }
  const result = await redeemCoupon(code, user.id);
  return Response.json(result, { status: result.status });
}
