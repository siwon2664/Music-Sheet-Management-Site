-- 유저를 탈퇴/삭제해도 그 유저가 만든 악보(sheets)와 콘티(setlists)는 남도록 한다.
-- 기존에는 created_by가 on delete cascade라, 유저를 지우면 그 사람이 만든 콘텐츠까지
-- 통째로 같이 삭제됐다. created_by를 nullable로 바꾸고 on delete set null로 변경해서,
-- 유저는 사라져도 콘텐츠는 남고 "만든 사람" 정보만 비워지게 한다.
-- (앱 코드에서 created_by는 저장 시에만 쓰이고 화면에 표시되지 않아 nullable로 바꿔도 영향 없음)

alter table public.sheets
  drop constraint sheets_created_by_fkey,
  alter column created_by drop not null,
  add constraint sheets_created_by_fkey
    foreign key (created_by) references public.users (id) on delete set null;

alter table public.setlists
  drop constraint setlists_created_by_fkey,
  alter column created_by drop not null,
  add constraint setlists_created_by_fkey
    foreign key (created_by) references public.users (id) on delete set null;
