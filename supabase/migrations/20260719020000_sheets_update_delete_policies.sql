-- sheets 테이블에는 select/insert 정책만 있고 update/delete 정책이 없어서,
-- 악보 정보 수정은 물론 기존 "선택 삭제" 기능도 RLS에 막혀 0행 영향으로 조용히
-- 실패하고 있었다. insert와 동일하게 팀원이면 누구나 수정할 수 있게 하고,
-- 삭제는 프론트(SheetsLibraryClient의 canDelete = role === 'LEADER')와 맞춰
-- 팀장만 가능하도록 제한한다.

create policy "members can update team sheets" on public.sheets
  for update using (
    exists (
      select 1 from public.team_members tm
      where tm.team_id = sheets.team_id and tm.user_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from public.team_members tm
      where tm.team_id = sheets.team_id and tm.user_id = auth.uid()
    )
  );

create policy "leaders can delete team sheets" on public.sheets
  for delete using (
    exists (
      select 1 from public.team_members tm
      where tm.team_id = sheets.team_id
        and tm.user_id = auth.uid()
        and tm.role = 'LEADER'
    )
  );
