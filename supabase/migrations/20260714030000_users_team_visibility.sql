-- 팀원 관리 화면에서 같은 팀 멤버의 이메일/이름을 볼 수 있도록 허용.
-- 기존 users_select_own 정책(본인만 조회)에 추가되는 permissive 정책이라
-- 기존 동작을 깨지 않는다.
create policy "team members can view teammates profiles" on public.users
for select using (
  exists (
    select 1
    from public.team_members my
    join public.team_members their on their.team_id = my.team_id
    where my.user_id = auth.uid()
      and their.user_id = users.id
  )
);
