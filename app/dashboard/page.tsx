import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import CreateTeamForm from '@/components/team/CreateTeamForm';
import TopNav from '@/components/dashboard/TopNav';
import DashboardCalendar from '@/components/dashboard/DashboardCalendar';
import FixedSetlists from '@/components/dashboard/FixedSetlists';

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

  // 단일 팀 구조: 유저가 속한 첫 번째 팀을 사용한다.
  const { data: membership } = await supabase
    .from('team_members')
    .select('team_id, role')
    .eq('user_id', user.id)
    .order('joined_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!membership) {
    return (
      <main className="min-h-screen p-8 max-w-md mx-auto flex flex-col gap-6">
        <header>
          <h1 className="text-2xl font-bold">대시보드</h1>
          <p className="text-sm text-gray-500 mt-1">
            아직 속한 팀이 없습니다. 아래에서 새 팀을 만들어보세요.
          </p>
        </header>
        <CreateTeamForm />
      </main>
    );
  }

  const { data: team } = await supabase
    .from('teams')
    .select('id, name')
    .eq('id', membership.team_id)
    .single();

  if (!team) {
    redirect('/login');
  }

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
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <TopNav
        teamName={team.name}
        email={user.email ?? ''}
        displayName={profile?.display_name ?? null}
        avatarUrl={profile?.avatar_url ?? null}
        role={membership.role}
      />
      <main className="flex-1 p-4 md:p-6 max-w-6xl w-full mx-auto">
        <DashboardCalendar
          teamId={team.id}
          role={membership.role}
          year={year}
          month={month}
          setlists={monthSetlists}
        />
        <FixedSetlists setlists={fixedSetlists ?? []} />
      </main>
    </div>
  );
}
