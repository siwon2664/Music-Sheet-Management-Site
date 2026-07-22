-- 회원 탈퇴(계정 삭제) RPC.
-- auth.users에서 직접 delete하면 public.users(id references auth.users on delete
-- cascade)가 함께 삭제되고, 그 아래 team_members/drawings 등도 연쇄 삭제된다.
-- 다만 teams.created_by는 on delete cascade라, 팀을 개설한 사람이 그대로
-- 탈퇴하면 팀 전체(다른 멤버의 악보·콘티·필기까지)가 통째로 함께 삭제된다.
-- leave_team()이 개설자의 팀 탈퇴를 막는 것과 동일한 이유로, 개설한 팀이 남아
-- 있는 동안은 계정 탈퇴도 막는다.
create or replace function public.delete_own_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from public.teams where created_by = auth.uid()
  ) then
    raise exception '개설한 팀이 있어 탈퇴할 수 없습니다. 팀 관리에서 해당 팀을 먼저 삭제해주세요.';
  end if;

  delete from auth.users where id = auth.uid();
end;
$$;
