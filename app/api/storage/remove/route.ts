// app/api/storage/remove/route.ts
// POST /api/storage/remove
// body: { paths: string[] }
// 'r2/' 경로는 팀 멤버십 확인 후 R2에서, 나머지(기존 Supabase 경로)는 서버
// Supabase 클라이언트로 삭제한다. 호출 쪽은 이미 DB 행 삭제가 끝난 뒤 이 라우트를
// fire-and-forget으로 부르는 패턴이라, 여기서도 베스트 에포트로 처리하고 항상
// 200을 반환한다 — 실패해도 findOrphanedStorage 스크립트로 나중에 정리 가능.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isTeamMember } from '@/lib/serverTeamAuth';
import { getR2PathTeamId, isR2Path } from '@/lib/storage';
import { deleteR2Objects } from '@/lib/r2';

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

  const r2Keys: string[] = [];
  const legacyPaths: string[] = [];

  for (const path of paths) {
    if (isR2Path(path)) {
      const teamId = getR2PathTeamId(path);
      if (teamId && (await checkMembership(teamId))) r2Keys.push(path);
    } else {
      legacyPaths.push(path);
    }
  }

  await Promise.all([
    r2Keys.length > 0 ? deleteR2Objects(r2Keys).catch(() => {}) : Promise.resolve(),
    legacyPaths.length > 0
      ? supabase.storage
          .from('sheets')
          .remove(legacyPaths)
          .catch(() => {})
      : Promise.resolve(),
  ]);

  return NextResponse.json({ ok: true });
}
