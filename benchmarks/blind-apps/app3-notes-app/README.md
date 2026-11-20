# Notes App

A small notes application built with Vite, React, Tailwind CSS and Supabase.

## Features

- Sign up / log in with email and password (Supabase Auth)
- Create notes with a title and a body (plain textarea)
- Edit and delete notes
- Search across notes by title and content
- Per-user data isolation via Postgres Row Level Security

## Stack

- [Vite](https://vite.dev/) + [React](https://react.dev/)
- [Tailwind CSS](https://tailwindcss.com/) v4 (via the Vite plugin)
- [Supabase](https://supabase.com/) — auth plus a `notes` table created by the
  migration in `supabase/migrations/`

## Getting started

```bash
# 1. Install dependencies
npm install

# 2. Start the local Supabase stack (requires Docker).
#    This applies the migration that creates the `notes` table and serves
#    the API on http://127.0.0.1:54331 (see supabase/config.toml — non-default
#    ports are used so multiple local Supabase projects can run side by side).
npx supabase start

# 3. Run the app (serves on http://localhost:5174)
npm run dev
```

To use a hosted Supabase project instead of the local stack, copy
`.env.example` to `.env`, fill in your project's URL and anon key, and apply
the migration with `npx supabase db push`.

## Configuration

Environment variables (see `.env` and `.env.example`):

| Variable                 | Description                        |
| ------------------------ | ---------------------------------- |
| `VITE_SUPABASE_URL`      | Supabase API URL                   |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon/public key           |

## Project structure

```
supabase/
  config.toml                  # Local Supabase stack configuration
  migrations/                  # SQL migration creating the notes table (+RLS)
src/
  main.jsx                     # Entry point
  App.jsx                      # Routes between auth screen and notes app
  context/AuthContext.jsx      # Supabase auth state (session, sign in/out)
  hooks/useNotes.js            # Fetch/create/update/delete notes
  components/
    AuthScreen.jsx             # Sign in / sign up form
    NotesApp.jsx               # App shell (header, list, editor)
    NoteList.jsx               # Search + note list sidebar
    NoteEditor.jsx              # Title input + textarea editor
```
