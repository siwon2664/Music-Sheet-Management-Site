-- setlists (콘티): 팀의 날짜별 공연/합주 콘티
create table if not exists public.setlists (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  title text not null,
  description text,
  event_date date not null,
  created_by uuid not null default auth.uid() references public.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists setlists_team_id_event_date_idx
  on public.setlists (team_id, event_date);

alter table public.setlists enable row level security;

create policy "members can view team setlists" on public.setlists
  for select using (
    exists (
      select 1 from public.team_members tm
      where tm.team_id = setlists.team_id and tm.user_id = auth.uid()
    )
  );

create policy "leaders can create team setlists" on public.setlists
  for insert with check (
    exists (
      select 1 from public.team_members tm
      where tm.team_id = setlists.team_id
        and tm.user_id = auth.uid()
        and tm.role = 'LEADER'
    )
  );
