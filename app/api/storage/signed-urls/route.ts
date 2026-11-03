// app/api/storage/signed-urls/route.ts
// POST /api/storage/signed-urls
// body: { paths: string[] }
// 경로가 'r2/'로 시작하면(새로 올린 파일) 팀 멤버십을 확인한 뒤 R2 presigned GET을
// 발급하고, 아니면(기존 Supabase Storage에 남아있는 파일) 서버 Supabase 클라이언트로
// 그대로 createSignedUrls를 호출한다 — Postgres RLS가 이미 멤버십을 걸러주므로
// 이쪽은 별도 권한 체크가 필요 없다. 응답 순서는 요청한 paths 순서와 동일하다.
// 한쪽 백엔드가 실패해도(예: Supabase Storage가 막혀있는 상태) 나머지는 정상
// 응답하도록 항목별로 null 처리한다.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isTeamMember } from '@/lib/serverTeamAuth';
import { getR2PathTeamId, isR2Path } from '@/lib/storage';
import { getPresignedDownloadUrl } from '@/lib/r2';

export async function POST(request: Request) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  }

  let body: { paths?: string[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '잘못된 요청 본문입니다.' }, { status: 400 });
  }

  const paths = body.paths ?? [];
  const userId = user.id;

  const membershipCache = new Map<string, boolean>();
  async function checkMembership(teamId: string): Promise<boolean> {
    if (!membershipCache.has(teamId)) {
      membershipCache.set(teamId, await isTeamMember(supabase, userId, teamId));
    }
    return membershipCache.get(teamId)!;
  }

  const legacyPaths = paths.filter((p) => !isR2Path(p));
  const legacyUrlMap = new Map<string, string | null>();

  if (legacyPaths.length > 0) {
    const { data } = await supabase.storage.from('sheets').createSignedUrls(legacyPaths, 60 * 60);
    data?.forEach((entry, i) => {
      legacyUrlMap.set(legacyPaths[i], entry?.signedUrl ?? null);
    });
  }

  const urls = await Promise.all(
    paths.map(async (path): Promise<string | null> => {
      if (!isR2Path(path)) {
        return legacyUrlMap.get(path) ?? null;
      }
      const teamId = getR2PathTeamId(path);
      if (!teamId || !(await checkMembership(teamId))) return null;
      try {
        return await getPresignedDownloadUrl(path);
      } catch {
        return null;
      }
    })
  );

  return NextResponse.json({ urls });
}
