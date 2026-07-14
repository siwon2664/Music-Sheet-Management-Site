-- band-setlist initial schema
-- users, teams, team_members, sheets, drawings + create_team() RPC + RLS

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- users (public profile mirrored from auth.users)
-- ---------------------------------------------------------------------------
create table if not exists public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, email, display_name)
  values (new.id, new.email, new.raw_user_meta_data ->> 'display_name');
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ---------------------------------------------------------------------------
-- teams
-- ---------------------------------------------------------------------------
create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  created_by uuid not null references public.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- team_members
-- ---------------------------------------------------------------------------
create type public.team_role as enum ('LEADER', 'MEMBER');

create table if not exists public.team_members (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  role public.team_role not null default 'MEMBER',
  joined_at timestamptz not null default now(),
  unique (team_id, user_id)
);

-- ---------------------------------------------------------------------------
-- sheets
-- ---------------------------------------------------------------------------
create table if not exists public.sheets (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  title text not null,
  composer text,
  key text,
  bpm integer,
  file_url text,
  page_count integer not null default 0,
  created_by uuid not null references public.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- drawings
-- ---------------------------------------------------------------------------
create table if not exists public.drawings (
  id uuid primary key default gen_random_uuid(),
  sheet_id uuid not null references public.sheets (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  page_number integer not null,
  coordinates jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- create_team(): insert team + LEADER membership atomically
-- ---------------------------------------------------------------------------
create or replace function public.create_team(p_name text, p_description text default null)
returns public.teams
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team public.teams;
begin
  insert into public.teams (name, description, created_by)
  values (p_name, p_description, auth.uid())
  returning * into v_team;

  insert into public.team_members (team_id, user_id, role)
  values (v_team.id, auth.uid(), 'LEADER');

  return v_team;
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.users enable row level security;
alter table public.teams enable row level security;
alter table public.team_members enable row level security;
alter table public.sheets enable row level security;
alter table public.drawings enable row level security;

create policy "users can view own profile" on public.users
  for select using (id = auth.uid());

create policy "users can update own profile" on public.users
  for update using (id = auth.uid());

create policy "members can view their teams" on public.teams
  for select using (
    exists (
      select 1 from public.team_members tm
      where tm.team_id = teams.id and tm.user_id = auth.uid()
    )
  );

create policy "members can view team membership" on public.team_members
  for select using (
    exists (
      select 1 from public.team_members tm
      where tm.team_id = team_members.team_id and tm.user_id = auth.uid()
    )
  );

create policy "members can view team sheets" on public.sheets
  for select using (
    exists (
      select 1 from public.team_members tm
      where tm.team_id = sheets.team_id and tm.user_id = auth.uid()
    )
  );

create policy "members can insert team sheets" on public.sheets
  for insert with check (
    exists (
      select 1 from public.team_members tm
      where tm.team_id = sheets.team_id and tm.user_id = auth.uid()
    )
  );

create policy "members can view sheet drawings" on public.drawings
  for select using (
    exists (
      select 1
      from public.sheets s
      join public.team_members tm on tm.team_id = s.team_id
      where s.id = drawings.sheet_id and tm.user_id = auth.uid()
    )
  );

create policy "members can manage own drawings" on public.drawings
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
