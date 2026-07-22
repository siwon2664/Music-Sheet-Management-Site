// app/api/teams/active/route.ts
// POST /api/teams/active
// body: { teamId: string }
// "현재 활성 팀"을 쿠키에 저장한다. 팀 스위처에서 팀을 바꾸거나, 팀을 새로
// 만들거나 초대로 참여했을 때 그 팀을 바로 활성 팀으로 지정하기 위해 쓴다.

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { ACTIVE_TEAM_COOKIE } from '@/lib/activeTeam';

export async function POST(request: Request) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  }

  let body: { teamId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '잘못된 요청 본문입니다.' }, { status: 400 });
  }

  const teamId = body.teamId;
  if (!teamId) {
    return NextResponse.json({ error: 'teamId는 필수입니다.' }, { status: 400 });
  }

  const { data: membership } = await supabase
    .from('team_members')
    .select('team_id')
    .eq('team_id', teamId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (!membership) {
    return NextResponse.json({ error: '해당 팀의 멤버가 아닙니다.' }, { status: 403 });
  }

  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_TEAM_COOKIE, teamId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  });

  return NextResponse.json({ ok: true });
}
