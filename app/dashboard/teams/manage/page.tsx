import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { resolveActiveTeam } from '@/lib/activeTeam';
import CreateTeamForm from '@/components/team/CreateTeamForm';
import JoinTeamByCodeForm from '@/components/team/JoinTeamByCodeForm';
import TeamsManager from '@/components/team/TeamsManager';

export default async function ManageTeamsPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const { activeTeam, teams } = await resolveActiveTeam(supabase, user.id);

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
          <h1 className="text-2xl font-bold">팀 관리</h1>
          <p className="text-sm text-gray-500 mt-1">
            속한 팀을 전환하거나 탈퇴하고, 팀장이라면 팀을 삭제할 수도 있습니다.
          </p>
        </header>

        <TeamsManager teams={teams} activeTeamId={activeTeam?.id ?? null} />

        <div className="flex items-center gap-3 text-xs text-gray-400">
          <div className="flex-1 h-px bg-gray-200" />새 팀 추가
          <div className="flex-1 h-px bg-gray-200" />
        </div>
        <CreateTeamForm />
        <div className="flex items-center gap-3 text-xs text-gray-400">
          <div className="flex-1 h-px bg-gray-200" />
          또는
          <div className="flex-1 h-px bg-gray-200" />
        </div>
        <JoinTeamByCodeForm />
      </div>
    </main>
  );
}
