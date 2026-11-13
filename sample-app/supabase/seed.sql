-- Dev fixture data (applied by `supabase db reset` and on `supabase start`).
insert into profiles (id, email, name, credits, password) values
  ('00000000-0000-0000-0000-000000000001', 'alice@example.com', 'Alice Anderson', 500, 'secret123'),
  ('00000000-0000-0000-0000-000000000002', 'bob@example.com', 'Bob Brown', 300, 'secret123')
on conflict (id) do nothing;

insert into coupons (code, discount, used) values
  ('WELCOME10', 5, false)
on conflict (code) do nothing;
