-- 콘티 내에서 각 곡의 진행 순서(송폼 마커: A1, B2, Intro, 신디 등)를 저장한다.
-- 콘티 편집 화면에서만 입력하고, 연주 모드에서 악보 위에 플로팅으로 보여준다.
alter table public.setlist_sheets
  add column if not exists song_form text[] not null default '{}';
