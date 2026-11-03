// app/api/storage/upload-url/route.ts
// POST /api/storage/upload-url
// body: { path: string, contentType: string }
// 클라이언트(lib/storage.ts의 경로 빌더)가 만든 'r2/{teamId}/...' 경로에 대해,
// 요청한 유저가 해당 팀 멤버인지 확인한 뒤 R2 presigned PUT URL을 발급한다.
// 실제 파일 바이트는 이 서버를 거치지 않고 브라우저가 R2로 직접 전송한다
// (서버리스 함수의 요청 본문 크기 제한을 피하기 위함).

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isTeamMember } from '@/lib/serverTeamAuth';
import { getR2PathTeamId, isR2Path } from '@/lib/storage';
import { getPresignedUploadUrl } from '@/lib/r2';

export async function POST(request: Request) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  }

  let body: { path?: string; contentType?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '잘못된 요청 본문입니다.' }, { status: 400 });
  }

  const { path, contentType } = body;
  if (!path || !contentType || !isR2Path(path)) {
    return NextResponse.json({ error: '잘못된 경로입니다.' }, { status: 400 });
  }

  const teamId = getR2PathTeamId(path);
  if (!teamId || !(await isTeamMember(supabase, user.id, teamId))) {
    return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 });
  }

  try {
    const uploadUrl = await getPresignedUploadUrl(path, contentType);
    return NextResponse.json({ uploadUrl });
  } catch (err) {
    const message = err instanceof Error ? err.message : '업로드 URL 발급에 실패했습니다.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
