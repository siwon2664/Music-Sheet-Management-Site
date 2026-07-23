-- 베타 테스트 기간 동안 팀당 악보 개수를 50개로 제한한다.
-- 클라이언트 검증만으로는 API를 직접 호출해 우회할 수 있으므로 DB 트리거로도 막는다.
-- '다드림교회'는 실사용 중인 팀이라 이 제한에서 제외한다.

create or replace function public.enforce_sheet_limit()
returns trigger
language plpgsql
as $$
begin
  if (select count(*) from public.sheets where team_id = new.team_id) >= 50
     and not exists (select 1 from public.teams where id = new.team_id and name = '다드림교회')
  then
    raise exception '베타 테스트 기간 동안 팀당 악보는 최대 50개까지 등록할 수 있습니다.';
  end if;
  return new;
end;
$$;

create trigger sheets_enforce_limit
before insert on public.sheets
for each row
execute function public.enforce_sheet_limit();
