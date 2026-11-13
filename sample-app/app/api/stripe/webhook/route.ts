import { grantWebhookCredits } from '@/lib/store';

// Planted bug #10: receives Stripe checkout events and credits users, but never
// verifies the webhook signature.
export async function POST(req: Request) {
  const event = await req.json();
  if (event?.type === 'checkout.session.completed') {
    const credits = Number(event.data?.object?.metadata?.credits ?? 0);
    const userId = event.data?.object?.metadata?.userId;
    if (userId) await grantWebhookCredits(String(userId), credits);
  }
  return Response.json({ received: true });
}
