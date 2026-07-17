-- 이 앱은 유저당 팀 하나를 전제로 하지만(단일 팀 구조), 기존 create_team/join_team_via_invite는
-- 이미 팀이 있는 유저가 새 팀을 만들거나 다른 팀에 또 참여하는 걸 막지 않았다.
-- 그 결과 한 유저가 두 팀에 동시에 속하는 경우가 생겼고, 화면마다 "가입한 첫 팀"과
-- "특정 리소스가 속한 팀" 중 무엇을 기준으로 삼느냐가 달라 같은 유저인데도
-- 라이브러리와 콘티 편집에서 다른 팀의 데이터가 보이는 버그로 이어졌다.
-- 이제 이미 소속된 팀이 있으면 새 팀 생성/다른 팀 참여를 막는다.

create or replace function public.create_team(p_name text, p_description text default null)
returns public.teams
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team public.teams;
begin
  if exists (select 1 from public.team_members where user_id = auth.uid()) then
    raise exception '이미 소속된 팀이 있습니다. 한 계정은 하나의 팀에만 속할 수 있습니다.';
  end if;

  insert into public.teams (name, description, created_by)
  values (p_name, p_description, auth.uid())
  returning * into v_team;

  insert into public.team_members (team_id, user_id, role)
  values (v_team.id, auth.uid(), 'LEADER');

  return v_team;
end;
$$;

create or replace function public.join_team_via_invite(p_token uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team_id uuid;
begin
  select id into v_team_id from public.teams where invite_token = p_token;

  if v_team_id is null then
    raise exception '유효하지 않은 초대 링크입니다.';
  end if;

  if exists (
    select 1 from public.team_members
    where user_id = auth.uid() and team_id <> v_team_id
  ) then
    raise exception '이미 다른 팀에 속해 있습니다. 한 계정은 하나의 팀에만 속할 수 있습니다.';
  end if;

  insert into public.team_members (team_id, user_id, role)
  values (v_team_id, auth.uid(), 'MEMBER')
  on conflict (team_id, user_id) do nothing;

  return v_team_id;
end;
$$;
