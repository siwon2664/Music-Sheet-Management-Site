import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { resolveActiveTeam } from '@/lib/activeTeam';
import MobileBottomNav from '@/components/dashboard/MobileBottomNav';

// /dashboard 하위 모든 페이지에 공통으로 씌우는 레이아웃. 태블릿/모바일
// (lg 미만) 화면에서 하단 탭바(Main / 악보 라이브러리)가 항상 보이도록 여기
// 한 곳에서만 붙인다 — 이렇게 하면 하위 페이지들은 손대지 않아도 된다.
// 프로필은 하단 탭바에 넣지 않고 기존처럼 화면 크기 상관없이 오른쪽 위
// ProfileMenu(TopNav)로만 노출한다.
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const { activeTeam } = await resolveActiveTeam(supabase, user.id);

  return (
    <div className={activeTeam ? 'pb-16 lg:pb-0' : undefined}>
      {children}
      {activeTeam && <MobileBottomNav />}
    </div>
  );
}
