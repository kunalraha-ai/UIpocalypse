import { cookies } from 'next/headers';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { findUserById } from '@/lib/store';

const SECRET = process.env.SESSION_SECRET ?? 'phase0-dev-secret';

export function signSession(userId: string): string {
  const mac = createHmac('sha256', SECRET).update(userId).digest('hex').slice(0, 16);
  return `${userId}.${mac}`;
}

export function verifySession(token: string | undefined): string | null {
  if (!token) return null;
  const dot = token.lastIndexOf('.');
  if (dot < 1) return null;
  const userId = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  const expected = createHmac('sha256', SECRET).update(userId).digest('hex').slice(0, 16);
  try {
    if (mac.length !== expected.length) return null;
    if (!timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
  } catch {
    return null;
  }
  return userId;
}

export async function getSessionUser() {
  const jar = await cookies();
  const userId = verifySession(jar.get('session')?.value);
  if (!userId) return null;
  return findUserById(userId) ?? null;
}
