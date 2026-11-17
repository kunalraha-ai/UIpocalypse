-- Fixture: one table without RLS (should fire), one with (should not).
create table if not exists no_rls (
  id uuid primary key default gen_random_uuid()
);

create table if not exists yes_rls (
  id uuid primary key default gen_random_uuid()
);
alter table yes_rls enable row level security;

-- permissive-rls fixture: using (true) must fire…
create policy anyone_read on yes_rls for select using (true);
-- …while a scoped policy must not.
create policy owner_read on yes_rls for select using (auth.uid() = id);
