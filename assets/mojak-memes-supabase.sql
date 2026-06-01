-- MOJAK community meme wall — run in Supabase SQL editor
create table if not exists public.mojak_memes (
  id uuid primary key default gen_random_uuid(),
  url text not null,
  type text not null default 'image',
  caption text,
  hidden boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.mojak_memes enable row level security;
-- anyone can read non-hidden memes
create policy "read visible" on public.mojak_memes for select using (hidden = false);
-- anyone (anon) can post
create policy "anon insert" on public.mojak_memes for insert with check (true);
-- NOTE: moderation (hide/delete) is done by you in the Supabase dashboard,
-- or via the service key. No public update/delete policy is granted on purpose.

-- STORAGE: create a PUBLIC bucket named  mojak-memes  (Dashboard → Storage → New bucket → Public)
-- then allow anon uploads to it:
insert into storage.buckets (id, name, public) values ('mojak-memes','mojak-memes', true)
  on conflict (id) do update set public = true;
create policy "anon upload mojak" on storage.objects for insert
  with check (bucket_id = 'mojak-memes');
create policy "public read mojak" on storage.objects for select
  using (bucket_id = 'mojak-memes');
