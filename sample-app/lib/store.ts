// Real Supabase data layer (service-role, server-side only — never import from
// client components). This replaced the Phase 0 in-memory mock; the SQL schema
// lives in supabase/migrations/ and the fixtures in supabase/seed.sql.
//
// Planted bugs #4/#5 are preserved against the real database: no idempotency
// on buys, and the coupon check/write are separate round trips (TOCTOU).

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export type User = { id: string; email: string; name: string; password: string | null; credits: number };
export type Product = { id: string; name: string; price: number };
export type Pack = { id: string; dollars: number; credits: number };
export type Coupon = { code: string; discount: number; used: boolean; redeemed_by: string | null };

let _db: SupabaseClient | null = null;

function db(): SupabaseClient {
  if (!_db) {
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!key) {
      throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set — copy .env.example to .env.local and fill in the keys `supabase start` prints.');
    }
    _db = createClient(process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321', key);
  }
  return _db;
}

export const products: Product[] = [
  { id: 'p1', name: 'Desk Lamp', price: 12 },
  { id: 'p2', name: 'Floor Lamp', price: 18 },
  { id: 'p3', name: 'Lamp Shade', price: 6 },
  { id: 'p4', name: 'Office Chair', price: 89 },
  { id: 'p5', name: 'Dining Chair', price: 45 },
  { id: 'p6', name: 'Standing Desk', price: 199 },
];

export const packs: Pack[] = [
  { id: 'p5', dollars: 5, credits: 500 },
  { id: 'p10', dollars: 10, credits: 1100 },
  { id: 'p20', dollars: 20, credits: 2400 },
];

export async function findUserByEmail(email: string): Promise<User | null> {
  const { data } = await db().from('profiles').select('*').eq('email', email).maybeSingle();
  return (data as User) ?? null;
}

export async function findUserById(id: string): Promise<User | null> {
  const { data } = await db().from('profiles').select('*').eq('id', id).maybeSingle();
  return (data as User) ?? null;
}

export async function updateUserName(id: string, name: string): Promise<void> {
  await db().from('profiles').update({ name }).eq('id', id);
}

export async function buyCredits(userId: string, packId: string) {
  const pack = packs.find((p) => p.id === packId);
  if (!pack) return { status: 400 as const, error: 'Unknown pack' };
  const { data: user, error: userErr } = await db()
    .from('profiles')
    .select('id, credits')
    .eq('id', userId)
    .maybeSingle();
  if (userErr) return { status: 500 as const, error: userErr.message };
  if (!user) return { status: 401 as const, error: 'Not signed in' };

  // Planted bug #4: no idempotency key and no server-side double-submit guard —
  // two rapid POSTs insert two transactions (and can even lose the update).
  const txId = `tx_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const { error: txErr } = await db()
    .from('transactions')
    .insert({ id: txId, user_id: userId, pack_id: packId, credits: pack.credits });
  if (txErr) return { status: 500 as const, error: txErr.message };

  // read-modify-write — concurrent buys can drop each other's update
  const { data: updated, error: updErr } = await db()
    .from('profiles')
    .update({ credits: user.credits + pack.credits })
    .eq('id', userId)
    .select('credits')
    .maybeSingle();
  if (updErr) return { status: 500 as const, error: updErr.message };
  return { status: 200 as const, balance: updated?.credits ?? user.credits };
}

export async function redeemCoupon(code: string, userId: string) {
  const { data: coupon, error: readErr } = await db()
    .from('coupons')
    .select('*')
    .eq('code', code.trim().toUpperCase())
    .maybeSingle();
  if (readErr) return { status: 500 as const, error: readErr.message };
  if (!coupon) return { status: 404 as const, error: 'Coupon not found' };
  if (coupon.used) return { status: 409 as const, error: 'Coupon already redeemed' };

  // Planted bug #5: the check and the write are separate round trips — no
  // transaction, no row lock, no conditional update. Concurrent redeemers all
  // pass the check above before the first write lands.
  const { error: updErr } = await db()
    .from('coupons')
    .update({ used: true, redeemed_by: userId })
    .eq('code', coupon.code);
  if (updErr) return { status: 500 as const, error: updErr.message };

  await db().from('coupon_redemptions').insert({ code: coupon.code, user_id: userId });
  return { status: 200 as const, discount: coupon.discount };
}

export async function placeOrder(userId: string, total: number, couponCode: string | null) {
  const id = `ord_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const { error } = await db()
    .from('orders')
    .insert({ id, user_id: userId, total, coupon_code: couponCode });
  if (error) throw new Error(error.message);
  return { id, total };
}

export async function deleteAccount(userId: string): Promise<boolean> {
  const { data, error } = await db().from('profiles').delete().eq('id', userId).select('id');
  if (error) throw new Error(error.message);
  return (data?.length ?? 0) > 0; // destructive for real — the swarm must never trigger this
}

export async function grantWebhookCredits(userId: string, credits: number): Promise<void> {
  const { data: user } = await db().from('profiles').select('credits').eq('id', userId).maybeSingle();
  if (!user) return;
  await db().from('profiles').update({ credits: user.credits + credits }).eq('id', userId);
}
