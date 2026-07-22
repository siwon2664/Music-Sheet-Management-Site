-- 팀 관리 화면에서 "팀 삭제"와 "팀 탈퇴"를 지원하기 위한 RPC.
-- teams/team_members에는 delete RLS 정책이 전혀 없어서(팀 생성은 create_team()이
-- security definer로 우회했을 뿐) 지금까지 클라이언트에서 팀을 삭제하거나
-- 스스로 탈퇴할 방법이 아예 없었다.

-- 팀장이 팀 자체를 삭제한다. sheets/setlists/drawings/team_members는 전부
-- team_id에 on delete cascade가 걸려 있어 teams row 하나만 지우면 함께 정리된다.
create or replace function public.delete_team(p_team_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.team_members
    where team_id = p_team_id and user_id = auth.uid() and role = 'LEADER'
  ) then
    raise exception '팀장만 팀을 삭제할 수 있습니다.';
  end if;

  delete from public.teams where id = p_team_id;
end;
$$;

-- 본인이 스스로 팀에서 탈퇴한다. 팀을 만든 사람(created_by)은 탈퇴할 수 없고,
-- 대신 팀 자체를 삭제해야 한다(팀장 위임 기능이 없기 때문).
create or replace function public.leave_team(p_team_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from public.teams where id = p_team_id and created_by = auth.uid()
  ) then
    raise exception '팀을 만든 사람은 탈퇴할 수 없습니다. 팀을 삭제해주세요.';
  end if;

  delete from public.team_members
  where team_id = p_team_id and user_id = auth.uid();
end;
$$;
