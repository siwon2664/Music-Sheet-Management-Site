-- 콘티 편집 화면(setlist editor)에 필요한 컬럼 추가
-- setlist_sheets: 콘티 내에서만 적용되는 이조 Key와 송폼 메모
-- sheets: 태그 필터링(#빠른찬양, #경배 등)

alter table public.setlist_sheets add column if not exists transposed_key text;
alter table public.setlist_sheets add column if not exists note text;
alter table public.sheets add column if not exists tags text[] not null default '{}';
