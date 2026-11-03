// app/api/storage/upload-url/route.ts
// POST /api/storage/upload-url
// body: { path: string, contentType: string, size: number }
// 클라이언트(lib/storage.ts의 경로 빌더)가 만든 'r2/{teamId}/...' 경로에 대해,
// 경로·형식·크기를 검사하고 요청한 유저가 해당 팀 멤버인지 확인한 뒤 R2 presigned
// PUT URL을 발급한다.
// 실제 파일 바이트는 이 서버를 거치지 않고 브라우저가 R2로 직접 전송한다
// (서버리스 함수의 요청 본문 크기 제한을 피하기 위함).

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isTeamMember } from '@/lib/serverTeamAuth';
import { getR2PathTeamId } from '@/lib/storage';
import { validateSheetUpload } from '@/lib/fileTypes';
import { MAX_TEAM_STORAGE_BYTES, TEAM_STORAGE_LIMIT_MESSAGE } from '@/lib/limits';
import { getPresignedUploadUrl, getR2PrefixSize } from '@/lib/r2';

export async function POST(request: Request) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  }

  let body: { path: string; contentType: string; size: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '잘못된 요청 본문입니다.' }, { status: 400 });
  }

  const { path, contentType, size } = body;
  const invalid = validateSheetUpload(path, contentType, size);
  if (invalid) {
    return NextResponse.json({ error: invalid }, { status: 400 });
  }

  const teamId = getR2PathTeamId(path);
  if (!teamId || !(await isTeamMember(supabase, user.id, teamId))) {
    return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 });
  }

  try {
    // DB가 아니라 R2를 직접 세므로 URL만 받아 올리고 sheets 행을 안 만드는 경우도 포함된다.
    // ponytail: 동시 업로드끼리는 서로 못 봐서 상한을 조금 넘을 수 있다. 엄격해야 하면 팀별 사용량을 DB에서 예약한다.
    const usedBytes = await getR2PrefixSize(`r2/${teamId}/`);
    if (usedBytes + size > MAX_TEAM_STORAGE_BYTES) {
      return NextResponse.json({ error: TEAM_STORAGE_LIMIT_MESSAGE }, { status: 413 });
    }

    const uploadUrl = await getPresignedUploadUrl(path, contentType, size);
    return NextResponse.json({ uploadUrl });
  } catch (err) {
    const message = err instanceof Error ? err.message : '업로드 URL 발급에 실패했습니다.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
