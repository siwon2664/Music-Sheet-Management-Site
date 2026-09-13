import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { resolveActiveTeam } from '@/lib/activeTeam';
import CreateTeamForm from '@/components/team/CreateTeamForm';
import JoinTeamByCodeForm from '@/components/team/JoinTeamByCodeForm';
import TopNav from '@/components/dashboard/TopNav';
import DashboardCalendar from '@/components/dashboard/DashboardCalendar';
import FixedSetlists from '@/components/dashboard/FixedSetlists';

// year/month 쿼리스트링에 따라 완전히 다른 데이터를 보여주는 페이지라
// 서버 쪽 캐시로 인해 이전 달의 응답이 재사용되지 않도록 명시적으로
// 매 요청마다 새로 렌더링하게 한다.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

function getMonthRange(year: number, month: number) {
  const pad = (n: number) => String(n).padStart(2, '0');
  const lastDay = new Date(year, month, 0).getDate();
  return {
    start: `${year}-${pad(month)}-01`,
    end: `${year}-${pad(month)}-${pad(lastDay)}`,
  };
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: { year?: string; month?: string };
}) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const { activeTeam, teams } = await resolveActiveTeam(supabase, user.id);

  if (!activeTeam) {
    return (
      <main className="min-h-screen p-8 max-w-md mx-auto flex flex-col gap-8">
        <header>
          <h1 className="text-2xl font-bold">대시보드</h1>
          <p className="text-sm text-gray-500 mt-1">
            아직 속한 팀이 없습니다. 새 팀을 만들거나, 팀장에게 받은 코드로 참여해보세요.
          </p>
        </header>
        <CreateTeamForm />
        <div className="flex items-center gap-3 text-xs text-gray-400">
          <div className="flex-1 h-px bg-gray-200" />
          또는
          <div className="flex-1 h-px bg-gray-200" />
        </div>
        <JoinTeamByCodeForm />
      </main>
    );
  }

  const team = activeTeam;

  const { data: profile } = await supabase
    .from('users')
    .select('display_name, avatar_url')
    .eq('id', user.id)
    .single();

  const now = new Date();
  const year = Number(searchParams.year) || now.getFullYear();
  const month = Number(searchParams.month) || now.getMonth() + 1;
  const { start, end } = getMonthRange(year, month);

  const { data: setlists } = await supabase
    .from('setlists')
    .select('id, title, event_date')
    .eq('team_id', team.id)
    .gte('event_date', start)
    .lte('event_date', end)
    .order('event_date', { ascending: true });

  // event_date는 스키마상 nullable이지만 위 gte/lte 필터로 null 행은 이미 제외된다.
  const monthSetlists = (setlists ?? []).filter(
    (setlist): setlist is typeof setlist & { event_date: string } => setlist.event_date !== null
  );

  // 날짜 없이(event_date IS NULL) 등록된 콘티 = 날짜에 상관없이 매번 쓰는 고정 콘티
  const { data: fixedSetlists } = await supabase
    .from('setlists')
    .select('id, title')
    .eq('team_id', team.id)
    .is('event_date', null)
    .order('created_at', { ascending: true });

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <TopNav
        teamName={team.name}
        teams={teams}
        activeTeamId={team.id}
        email={user.email ?? ''}
        displayName={profile?.display_name ?? null}
        avatarUrl={profile?.avatar_url ?? null}
        role={team.role}
      />
      <main className="flex-1 p-4 md:p-6 max-w-6xl w-full mx-auto">
        <FixedSetlists setlists={fixedSetlists ?? []} teamId={team.id} role={team.role} />
        <DashboardCalendar
          // year/month가 바뀌어도 클라이언트 사이드 이동(Link)에서는 같은
          // DashboardCalendar 인스턴스가 재사용된다. 그런데 그 컴포넌트는
          // setlists prop을 useState(setlists)로만 최초 1회 초기화해서
          // 로컬 state(setlistsState)에 들고 있기 때문에, 달을 옮겨도 그
          // state가 갱신되지 않고 예전 달 데이터를 그대로 들고 있었다(이게
          // "하드 리프레시하면 보이는데 링크로 이동하면 안 보이는" 증상의
          // 진짜 원인). year-month를 key로 줘서 달이 바뀔 때마다 컴포넌트를
          // 통째로 새로 마운트시켜 state가 항상 최신 setlists로 초기화되게 한다.
          key={`${year}-${month}`}
          teamId={team.id}
          role={team.role}
          year={year}
          month={month}
          setlists={monthSetlists}
        />
      </main>
    </div>
  );
}
