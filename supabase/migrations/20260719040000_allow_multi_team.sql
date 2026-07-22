-- 20260718000000_enforce_single_team.sql에서 걸었던 "한 계정은 팀 하나까지" 제약을 푼다.
-- 그 제약은 "화면마다 유저의 팀을 각자 다시 조회해서, 어떤 팀을 기준으로 삼을지가
-- 화면마다 달라지는" 버그를 막기 위한 임시 조치였다. 이제 앱 쪽에서 "현재 활성 팀"을
-- 쿠키(active_team_id) 하나로 통일해서 관리하도록 바꿨으므로, 유저가 여러 팀에 동시에
-- 속해도 더 이상 그 버그가 재현되지 않는다. 팀 전환 UI를 위해 다시 다중 팀을 허용한다.

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

  insert into public.team_members (team_id, user_id, role)
  values (v_team_id, auth.uid(), 'MEMBER')
  on conflict (team_id, user_id) do nothing;

  return v_team_id;
end;
$$;
