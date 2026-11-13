// Fixture: properly verifying webhook (should not fire).
import Stripe from 'stripe';

export async function POST(req: Request) {
  const raw = await req.text();
  const event = new Stripe('sk_test_fixture').webhooks.constructEvent(
    raw,
    req.headers.get('stripe-signature') ?? '',
    process.env.STRIPE_WEBHOOK_SECRET ?? '',
  );
  void event;
  return Response.json({ received: true });
}
