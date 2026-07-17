import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import MembersManager, { type MemberRow } from '@/components/dashboard/members/MembersManager';
import InviteLinkSection from '@/components/team/InviteLinkSection';

export default async function MembersPage() {
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

  if (!membership || membership.role !== 'LEADER') {
    redirect('/dashboard');
  }

  const [{ data: team }, { data: teamMembers }] = await Promise.all([
    supabase.from('teams').select('invite_token').eq('id', membership.team_id).single(),
    supabase
      .from('team_members')
      .select('id, user_id, role, users(email, display_name)')
      .eq('team_id', membership.team_id)
      .order('joined_at', { ascending: true }),
  ]);

  const members: MemberRow[] = (teamMembers ?? []).map((row) => {
    const profile = row.users as unknown as { email: string; display_name: string | null } | null;
    return {
      id: row.id,
      userId: row.user_id,
      email: profile?.email ?? '',
      displayName: profile?.display_name ?? null,
      role: row.role,
    };
  });

  return (
    <main className="min-h-screen bg-gray-50 p-4 md:p-6">
      <div className="max-w-2xl w-full mx-auto flex flex-col gap-4">
        <Link href="/dashboard" className="text-sm text-gray-500 underline w-fit">
          ← 대시보드로
        </Link>

        <header>
          <h1 className="text-2xl font-bold">멤버 관리</h1>
          <p className="text-sm text-gray-500 mt-1">역할을 바꾸거나 팀에서 제거할 수 있습니다.</p>
        </header>

        {team && <InviteLinkSection teamId={membership.team_id} initialToken={team.invite_token} />}

        <MembersManager currentUserId={user.id} initialMembers={members} />
      </div>
    </main>
  );
}
