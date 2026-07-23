-- 악보 업로드 파일 형식을 PDF/PNG/JPG/WEBP로 제한한다.
-- 프론트엔드 검증은 우회 가능하므로 버킷 자체에도 허용 MIME 타입을 걸어둔다.

update storage.buckets
set allowed_mime_types = array['application/pdf', 'image/png', 'image/jpeg', 'image/webp']
where id = 'sheets';
