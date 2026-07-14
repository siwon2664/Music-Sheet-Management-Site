-- 팀 초대 링크: 팀마다 초대 토큰 하나를 두고, 팀장이 재발급(=기존 링크 무효화)할 수 있다.

alter table public.teams add column if not exists invite_token uuid not null default gen_random_uuid();

-- 초대 링크 재발급 (팀장만)
create or replace function public.regenerate_invite_token(p_team_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token uuid;
begin
  if not is_team_leader(p_team_id) then
    raise exception '팀장만 초대 링크를 재발급할 수 있습니다.';
  end if;

  v_token := gen_random_uuid();
  update public.teams set invite_token = v_token where id = p_team_id;
  return v_token;
end;
$$;

-- 초대 토큰으로 팀 정보 조회 (아직 팀원이 아니어도 호출 가능)
create or replace function public.get_team_by_invite_token(p_token uuid)
returns table (team_id uuid, team_name text)
language sql
security definer
set search_path = public
as $$
  select id, name from public.teams where invite_token = p_token;
$$;

-- 초대 토큰으로 현재 로그인한 유저를 MEMBER로 추가
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
