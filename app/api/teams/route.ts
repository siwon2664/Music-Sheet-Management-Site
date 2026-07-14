// app/api/teams/route.ts
// POST /api/teams
// body: { name: string, description?: string }
// 프론트에서 supabase.rpc('create_team', ...)를 직접 쓰는 대신
// REST 엔드포인트를 통해 팀을 생성하고 싶을 때 사용하는 Route Handler.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function POST(request: Request) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  }

  let body: { name?: string; description?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '잘못된 요청 본문입니다.' }, { status: 400 });
  }

  const name = body.name?.trim();
  if (!name) {
    return NextResponse.json({ error: '팀 이름은 필수입니다.' }, { status: 400 });
  }

  // DB 함수(create_team)가 teams insert + team_members(LEADER) insert를
  // 하나의 트랜잭션으로 원자적으로 처리한다.
  const { data: team, error } = await supabase.rpc('create_team', {
    p_name: name,
    p_description: body.description,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ team }, { status: 201 });
}

export async function GET() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  }

  // 내가 속한 팀 목록 (RLS 정책에 의해 자동으로 본인이 속한 팀만 반환됨)
  const { data: teams, error } = await supabase
    .from('teams')
    .select('*, team_members!inner(role)')
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ teams });
}
