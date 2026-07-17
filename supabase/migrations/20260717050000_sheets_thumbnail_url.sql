-- 목록에서 쓰는 저용량 썸네일을 원본과 별도로 저장하기 위한 컬럼
alter table public.sheets
  add column if not exists thumbnail_url text;
