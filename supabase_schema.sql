-- ============================================================
-- Practex — Supabase schema
-- Run this once in your project: Supabase Dashboard → SQL Editor → New query → paste → Run
-- ============================================================

-- 1) Questions table — one row per MCQ. The whole question object (question text,
--    options, answer, explanation, tags, learning/FSRS state, etc.) is stored as-is
--    in the `data` JSONB column, matching the shape the app already uses in memory.
--    `id` is TEXT (not uuid) because the app generates its own ids client-side
--    (e.g. "m_ab12cd34...") rather than real UUIDs.
create table if not exists public.mcqs (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create index if not exists mcqs_user_id_idx on public.mcqs (user_id);

alter table public.mcqs enable row level security;

create policy "Users can view their own mcqs"
  on public.mcqs for select
  using (auth.uid() = user_id);

create policy "Users can insert their own mcqs"
  on public.mcqs for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own mcqs"
  on public.mcqs for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete their own mcqs"
  on public.mcqs for delete
  using (auth.uid() = user_id);


-- 2) Per-user settings/preferences — one row per signed-in user. Small, infrequently
--    changing blobs (sources, streak, sleeping subjects, FSRS/dark-mode toggles,
--    paused session) are consolidated here instead of one table per setting, so
--    toggling any of them is a single upsert.
create table if not exists public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  sources jsonb default '{}'::jsonb,
  paused_session jsonb,
  fsrs_mode_enabled boolean default true,
  dark_mode boolean default false,
  streak jsonb default '{"count":0,"lastDate":null}'::jsonb,
  fsrs_card_expanded boolean default true,
  sleeping_subjects jsonb default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.user_settings enable row level security;

create policy "Users can view their own settings"
  on public.user_settings for select
  using (auth.uid() = user_id);

create policy "Users can insert their own settings"
  on public.user_settings for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own settings"
  on public.user_settings for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Note: user_settings never needs a delete policy from the app itself; if you want
-- a user to be able to fully erase their account data, add one, or just rely on
-- `on delete cascade` when the underlying auth.users row is deleted.
