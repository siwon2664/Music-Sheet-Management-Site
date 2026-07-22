import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { resolveActiveTeam } from '@/lib/activeTeam';
import InviteLinkSection from '@/components/team/InviteLinkSection';

export default async function SettingsPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const { activeTeam } = await resolveActiveTeam(supabase, user.id);

  const { data: team } =
    activeTeam?.role === 'LEADER'
      ? await supabase.from('teams').select('invite_token').eq('id', activeTeam.id).single()
      : { data: null };

  return (
    <main className="min-h-screen bg-gray-50 p-4 md:p-6">
      <div className="max-w-lg w-full mx-auto flex flex-col gap-6">
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-1 text-sm text-gray-600 border rounded-lg px-3 py-2 w-fit hover:bg-gray-50 active:bg-gray-100"
        >
          ← 대시보드로
        </Link>

        <header>
          <h1 className="text-2xl font-bold">설정</h1>
        </header>

        {activeTeam && team ? (
          <InviteLinkSection teamId={activeTeam.id} initialToken={team.invite_token} />
        ) : (
          <div className="bg-white border rounded-lg p-6">
            <p className="text-sm text-gray-500">
              {activeTeam ? '팀 코드는 팀장만 확인할 수 있습니다.' : '설정 항목은 준비 중입니다.'}
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
