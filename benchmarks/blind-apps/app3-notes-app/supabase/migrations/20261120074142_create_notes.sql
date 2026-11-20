-- Create the notes table for the notes app.
create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null default '',
  body text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.notes is 'Per-user notes with a title and a body.';

-- Row Level Security: every user can only see and manage their own notes.
alter table public.notes enable row level security;

create policy "Users can select their own notes"
  on public.notes
  for select
  using ((select auth.uid()) = user_id);

create policy "Users can insert their own notes"
  on public.notes
  for insert
  with check ((select auth.uid()) = user_id);

create policy "Users can update their own notes"
  on public.notes
  for update
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users can delete their own notes"
  on public.notes
  for delete
  using ((select auth.uid()) = user_id);

-- The web app talks to Supabase as an authenticated user.
grant select, insert, update, delete on public.notes to authenticated;

-- Speeds up fetching the notes belonging to a single user.
create index if not exists notes_user_id_idx on public.notes (user_id);
