-- Fixture auth: the sample app uses a deliberately naive email/password login
-- instead of real auth.users (out of scope for the planted-bug benchmark).
alter table profiles add column if not exists password text;
