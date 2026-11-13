import { NextRequest } from 'next/server';
import { getSessionUser } from '@/lib/session';

export async function GET() {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: 'Not signed in' }, { status: 401 });
  return Response.json({ id: user.id, email: user.email, name: user.name, credits: user.credits });
}

export async function PUT(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: 'Not signed in' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  if (typeof body.name !== 'string' || !body.name.trim()) {
    return Response.json({ error: 'Name is required' }, { status: 400 });
  }
  user.name = body.name;
  return Response.json({ ok: true, name: user.name });
}
