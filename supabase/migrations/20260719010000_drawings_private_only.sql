-- 드로잉(마킹)은 본인만 보고 편집할 수 있어야 하는데, 기존 "members can view
-- sheet drawings" 정책이 같은 팀 멤버라면 서로의 드로잉을 조회할 수 있게 허용하고
-- 있었다. 앱 코드(DrawingLayer)는 애초에 본인 것만 조회하도록 짜여 있어 이 정책이
-- 실제로 쓰인 적은 없고, 오히려 API를 직접 호출하면 팀원의 마킹이 노출되는 구멍이었다.
-- "members can manage own drawings" 정책(for all, user_id = auth.uid())만으로
-- 조회/작성/수정/삭제가 전부 본인 소유로 제한되므로 아래 정책은 제거한다.
drop policy if exists "members can view sheet drawings" on public.drawings;
