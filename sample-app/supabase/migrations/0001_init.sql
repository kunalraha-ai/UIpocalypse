-- CreditCraft schema (sample app for UIpocalypse)
-- Kept realistic so the static analyzer can be tested against a proper Supabase
-- project layout. The Phase 0 runtime uses an in-memory mock (lib/store.ts).

create table if not exists profiles (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  name text not null,
  credits integer not null default 0,
  created_at timestamptz not null default now()
);

-- TODO: enable row level security before launch
-- (planted bug #9: profiles has no `alter table profiles enable row level security;`)

create table if not exists transactions (
  id text primary key,
  user_id uuid not null references profiles (id),
  pack_id text not null,
  credits integer not null,
  created_at timestamptz not null default now()
);
alter table transactions enable row level security;

create table if not exists coupons (
  code text primary key,
  discount integer not null,
  used boolean not null default false,
  redeemed_by uuid references profiles (id)
);
alter table coupons enable row level security;

create table if not exists coupon_redemptions (
  code text not null references coupons (code),
  user_id uuid not null references profiles (id),
  at timestamptz not null default now()
);
alter table coupon_redemptions enable row level security;

create table if not exists orders (
  id text primary key,
  user_id uuid not null references profiles (id),
  total integer not null,
  coupon_code text references coupons (code),
  created_at timestamptz not null default now()
);
alter table orders enable row level security;
