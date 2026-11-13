// Decoy #2: deliberately slow but successful request (4s). Slow is not broken.
export async function GET() {
  await new Promise((r) => setTimeout(r, 4000));
  return Response.json({
    items: [
      'Desk Lamp fans also bought Office Chair',
      'Floor Lamp fans also bought Lamp Shade',
      'Office Chair fans also bought Standing Desk',
    ],
  });
}
