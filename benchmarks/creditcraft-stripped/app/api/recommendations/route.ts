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
