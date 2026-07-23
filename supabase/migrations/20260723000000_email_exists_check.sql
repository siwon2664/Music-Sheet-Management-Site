-- 회원가입 폼에서 이메일 중복 여부를 제출 전에 미리 확인하기 위한 함수.
-- auth.users는 익명 사용자가 직접 조회할 수 없으므로, 존재 여부만
-- boolean으로 반환하는 security definer 함수로 우회한다.
create or replace function public.email_exists(p_email text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from auth.users where lower(email) = lower(p_email)
  );
$$;

grant execute on function public.email_exists(text) to anon, authenticated;
