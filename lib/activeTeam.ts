import { cookies } from 'next/headers';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, TeamRole } from '@/types/supabase';

export const ACTIVE_TEAM_COOKIE = 'active_team_id';

export interface UserTeam {
  id: string;
  name: string;
  role: TeamRole;
  isCreator: boolean;
}

export interface ActiveTeamResult {
  activeTeam: UserTeam | null;
  teams: UserTeam[];
}

// 유저가 속한 모든 팀 중 "현재 활성 팀"을 하나로 정해서 돌려준다. 화면마다
// 각자 "가입한 첫 팀"을 따로 조회하던 이전 방식은, 유저가 여러 팀에 속했을 때
// 화면 간에 서로 다른 팀 데이터를 보여주는 버그로 이어졌다. 이제 이 함수 하나만
// 대시보드 하위 페이지들이 공통으로 사용해서 "현재 팀"을 통일한다.
export async function resolveActiveTeam(
  supabase: SupabaseClient<Database>,
  userId: string
): Promise<ActiveTeamResult> {
  const { data: memberships } = await supabase
    .from('team_members')
    .select('team_id, role, joined_at, teams(name, created_by)')
    .eq('user_id', userId)
    .order('joined_at', { ascending: true });

  const teams: UserTeam[] = (memberships ?? []).map((m) => {
    const team = m.teams as unknown as { name: string; created_by: string | null } | null;
    return {
      id: m.team_id,
      name: team?.name ?? '',
      role: m.role,
      isCreator: team?.created_by === userId,
    };
  });

  if (teams.length === 0) {
    return { activeTeam: null, teams: [] };
  }

  const cookieStore = await cookies();
  const activeId = cookieStore.get(ACTIVE_TEAM_COOKIE)?.value;
  const active = (activeId && teams.find((t) => t.id === activeId)) || teams[0];

  return { activeTeam: active, teams };
}
