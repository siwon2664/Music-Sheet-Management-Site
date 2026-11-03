import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/supabase';

// 로그인한 유저가 해당 팀의 멤버인지 서버에서 확인한다. R2는 Supabase Storage의
// RLS 같은 DB 레벨 권한 체크가 없으므로, R2 객체를 다루는 API 라우트는 전부 이
// 함수로 직접 멤버십을 확인해야 한다. team_members 테이블 자체가 "내 멤버십만
// 보임" RLS로 보호되므로, 쿠키 세션 기반 서버 클라이언트로 조회하면 그 자체로
// 안전하다(다른 유저의 멤버십을 흉내낼 수 없음).
export async function isTeamMember(
  supabase: SupabaseClient<Database>,
  userId: string,
  teamId: string
): Promise<boolean> {
  const { data } = await supabase
    .from('team_members')
    .select('id')
    .eq('team_id', teamId)
    .eq('user_id', userId)
    .maybeSingle();
  return !!data;
}
