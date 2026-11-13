// Phase 0 stand-in for the Supabase data layer.
// The real schema lives in supabase/migrations/0001_init.sql; swap this module for
// the supabase client when running against a real local Supabase stack.
// All operations are async with simulated latency so that race windows behave
// like real database round trips.

export type User = { id: string; email: string; name: string; password: string; credits: number };
export type Product = { id: string; name: string; price: number };
export type Pack = { id: string; dollars: number; credits: number };
export type Transaction = { id: string; userId: string; packId: string; credits: number; at: number };
export type Coupon = { code: string; discount: number; used: boolean; redeemedBy: string | null };
export type Redemption = { code: string; userId: string; at: number };
export type Order = { id: string; userId: string; total: number; couponCode: string | null; at: number };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const dbLatency = () => sleep(40 + Math.random() * 40); // simulated Supabase round trip

const users: User[] = [
  { id: 'u_alice', email: 'alice@example.com', name: 'Alice Anderson', password: 'secret123', credits: 500 },
  { id: 'u_bob', email: 'bob@example.com', name: 'Bob Brown', password: 'secret123', credits: 300 },
];

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

const coupons: Coupon[] = [{ code: 'WELCOME10', discount: 5, used: false, redeemedBy: null }];
const transactions: Transaction[] = [];
const redemptions: Redemption[] = [];
const orders: Order[] = [];
let txCounter = 0;
let orderCounter = 0;

export function findUserByEmail(email: string) {
  return users.find((u) => u.email.toLowerCase() === email.toLowerCase());
}

export function findUserById(id: string) {
  return users.find((u) => u.id === id);
}

export async function buyCredits(userId: string, packId: string) {
  const pack = packs.find((p) => p.id === packId);
  const user = findUserById(userId);
  if (!user) return { status: 401 as const, error: 'Not signed in' };
  if (!pack) return { status: 400 as const, error: 'Unknown pack' };
  await dbLatency();
  // Planted bug #4: no idempotency key and no server-side double-submit guard,
  // so two rapid POSTs create two transactions (duplicate_write).
  const tx: Transaction = { id: `tx_${++txCounter}`, userId, packId, credits: pack.credits, at: Date.now() };
  transactions.push(tx);
  user.credits += pack.credits;
  return { status: 200 as const, balance: user.credits, tx };
}

export async function redeemCoupon(code: string, userId: string) {
  await dbLatency();
  const coupon = coupons.find((c) => c.code === code.trim().toUpperCase());
  if (!coupon) return { status: 404 as const, error: 'Coupon not found' };
  if (coupon.used) return { status: 409 as const, error: 'Coupon already redeemed' };
  await sleep(90); // write round trip — planted bug #5: the check and the write are not one transaction
  coupon.used = true;
  coupon.redeemedBy = userId;
  redemptions.push({ code: coupon.code, userId, at: Date.now() });
  return { status: 200 as const, discount: coupon.discount };
}

export function couponStats() {
  return {
    coupons: coupons.map((c) => ({ ...c })),
    redemptions: redemptions.filter((r) => r.code === 'WELCOME10').length,
  };
}

export async function placeOrder(userId: string, total: number, couponCode: string | null) {
  await dbLatency();
  const order: Order = { id: `ord_${++orderCounter}`, userId, total, couponCode, at: Date.now() };
  orders.push(order);
  return order;
}

export async function deleteAccount(userId: string) {
  await dbLatency();
  const idx = users.findIndex((u) => u.id === userId);
  if (idx >= 0) users.splice(idx, 1); // destructive for real — the swarm must never trigger this
  return idx >= 0;
}

export function grantWebhookCredits(userId: string, credits: number) {
  const user = findUserById(userId);
  if (user && credits > 0) user.credits += credits;
}
