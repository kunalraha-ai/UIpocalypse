import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/session';
import { deleteAccount } from '@/lib/store';

export async function POST() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  await deleteAccount(user.id); // genuinely destructive
  const res = NextResponse.json({ ok: true });
  res.cookies.delete('session');
  return res;
}
