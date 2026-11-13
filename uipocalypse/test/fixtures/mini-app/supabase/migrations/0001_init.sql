-- Fixture: one table without RLS (should fire), one with (should not).
create table if not exists no_rls (
  id uuid primary key default gen_random_uuid()
);

create table if not exists yes_rls (
  id uuid primary key default gen_random_uuid()
);
alter table yes_rls enable row level security;
