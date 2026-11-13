// Fixture: webhook route that never verifies the signature (should fire).
export async function POST(req: Request) {
  const event = await req.json();
  void event;
  return Response.json({ received: true });
}
