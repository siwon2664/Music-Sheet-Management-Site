-- 악보 파일 업로드를 위한 Storage 버킷 및 팀 단위 접근 정책
-- 파일 경로 규칙: {team_id}/{파일명} (첫 폴더가 team_id)

insert into storage.buckets (id, name, public)
values ('sheets', 'sheets', false)
on conflict (id) do nothing;

create policy "team members can read sheet files"
on storage.objects for select
using (
  bucket_id = 'sheets'
  and is_team_member((storage.foldername(name))[1]::uuid)
);

create policy "team members can upload sheet files"
on storage.objects for insert
with check (
  bucket_id = 'sheets'
  and is_team_member((storage.foldername(name))[1]::uuid)
);

create policy "team members can delete sheet files"
on storage.objects for delete
using (
  bucket_id = 'sheets'
  and is_team_member((storage.foldername(name))[1]::uuid)
);
