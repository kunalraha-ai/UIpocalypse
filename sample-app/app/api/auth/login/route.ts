import { NextRequest, NextResponse } from 'next/server';
import { findUserByEmail } from '@/lib/store';
import { signSession } from '@/lib/session';

export async function POST(req: NextRequest) {
  const { email, password } = await req.json().catch(() => ({}));
  const user = typeof email === 'string' ? findUserByEmail(email) : undefined;
  await new Promise((r) => setTimeout(r, 120)); // auth round trip
  if (!user || user.password !== password) {
    return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true, name: user.name });
  res.cookies.set('session', signSession(user.id), { httpOnly: true, sameSite: 'lax', path: '/' });
  return res;
}
