import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import InviteLinkSection from '@/components/team/InviteLinkSection';

export default async function SettingsPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const { data: membership } = await supabase
    .from('team_members')
    .select('team_id, role')
    .eq('user_id', user.id)
    .order('joined_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  const { data: team } =
    membership?.role === 'LEADER'
      ? await supabase.from('teams').select('invite_token').eq('id', membership.team_id).single()
      : { data: null };

  return (
    <main className="min-h-screen bg-gray-50 p-4 md:p-6">
      <div className="max-w-lg w-full mx-auto flex flex-col gap-6">
        <Link href="/dashboard" className="text-sm text-gray-500 underline w-fit">
          ← 대시보드로
        </Link>

        <header>
          <h1 className="text-2xl font-bold">설정</h1>
        </header>

        {membership && team ? (
          <InviteLinkSection teamId={membership.team_id} initialToken={team.invite_token} />
        ) : (
          <div className="bg-white border rounded-lg p-6">
            <p className="text-sm text-gray-500">
              {membership ? '팀 코드는 팀장만 확인할 수 있습니다.' : '설정 항목은 준비 중입니다.'}
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
