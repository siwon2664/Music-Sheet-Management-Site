import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import JoinTeamButton from '@/components/dashboard/JoinTeamButton';

export default async function JoinTeamPage({ params }: { params: { token: string } }) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/login?redirect=${encodeURIComponent(`/join/${params.token}`)}`);
  }

  const { data: invite } = await supabase
    .rpc('get_team_by_invite_token', { p_token: params.token })
    .maybeSingle();

  if (!invite) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center gap-4 p-8 text-center">
        <h1 className="text-xl font-semibold">유효하지 않은 초대 링크입니다</h1>
        <p className="text-sm text-gray-500">
          링크가 만료되었거나 잘못된 주소일 수 있습니다. 팀장에게 새 초대 링크를 요청해주세요.
        </p>
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-1 text-sm text-gray-600 border rounded-lg px-3 py-2 w-fit hover:bg-gray-50 active:bg-gray-100"
        >
          대시보드로
        </Link>
      </main>
    );
  }

  const { data: existingMembership } = await supabase
    .from('team_members')
    .select('id')
    .eq('team_id', invite.team_id)
    .eq('user_id', user.id)
    .maybeSingle();

  if (existingMembership) {
    redirect('/dashboard');
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-xl font-semibold">{invite.team_name} 팀에 참여하시겠어요?</h1>
      <p className="text-sm text-gray-500">{user.email}(으)로 팀에 합류합니다.</p>
      <JoinTeamButton token={params.token} />
    </main>
  );
}
