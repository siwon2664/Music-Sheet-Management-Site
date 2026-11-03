// app/api/teams/[id]/route.ts
// DELETE /api/teams/{id}
// delete_team RPC는 DB 행만 cascade로 지우므로, 팀의 R2 파일은 여기서 함께 지운다.
// 팀장 권한 확인은 RPC가 한다. R2 삭제는 팀이 지워진 뒤에만 실행하며, 실패해도
// 팀 삭제 자체는 이미 끝났으므로 성공으로 응답한다 — 남은 파일은
// scripts/findOrphanedStorage.mjs로 정리할 수 있다.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { deleteR2Prefix } from '@/lib/r2';

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  }

  const { error } = await supabase.rpc('delete_team', { p_team_id: params.id });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  try {
    await deleteR2Prefix(`r2/${params.id}/`);
  } catch (err) {
    console.error(`팀 ${params.id}의 R2 파일 삭제 실패:`, err);
  }

  return NextResponse.json({ ok: true });
}
