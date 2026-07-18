-- team_members에는 select 정책만 있고 update/delete 정책이 없어서, 멤버 관리 화면의
-- 역할 변경/추방 기능이 RLS에 막혀 조용히 실패하고 있었다. 팀장이면 팀원의 역할을
-- 바꾸거나 팀에서 제거할 수 있게 하되, 팀을 만든 사람(teams.created_by)의 row는
-- 항상 LEADER로 고정하고 제거도 못 하게 예외 처리한다.

create policy "leaders can update team member roles" on public.team_members
  for update using (
    exists (
      select 1 from public.team_members tm
      where tm.team_id = team_members.team_id
        and tm.user_id = auth.uid()
        and tm.role = 'LEADER'
    )
  )
  with check (
    -- 팀을 만든 사람의 role만은 어떤 경우에도 LEADER에서 벗어날 수 없다.
    team_members.role = 'LEADER'
    or not exists (
      select 1 from public.teams t
      where t.id = team_members.team_id and t.created_by = team_members.user_id
    )
  );

create policy "leaders can remove team members" on public.team_members
  for delete using (
    exists (
      select 1 from public.team_members tm
      where tm.team_id = team_members.team_id
        and tm.user_id = auth.uid()
        and tm.role = 'LEADER'
    )
    -- 팀을 만든 사람은 팀에서 제거할 수 없다.
    and not exists (
      select 1 from public.teams t
      where t.id = team_members.team_id and t.created_by = team_members.user_id
    )
  );
