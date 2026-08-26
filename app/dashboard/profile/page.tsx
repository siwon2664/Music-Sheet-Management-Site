import Link from 'next/link';
import { User } from 'lucide-react';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import UpdateDisplayNameForm from '@/components/dashboard/profile/UpdateDisplayNameForm';
import ChangePasswordForm from '@/components/dashboard/profile/ChangePasswordForm';
import DeleteAccountSection from '@/components/dashboard/profile/DeleteAccountSection';

export default async function ProfilePage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !user.email) {
    redirect('/login');
  }

  const { data: profile } = await supabase
    .from('users')
    .select('display_name, avatar_url')
    .eq('id', user.id)
    .single();

  return (
    <main className="min-h-screen bg-background p-4 md:p-6">
      <div className="max-w-lg w-full mx-auto flex flex-col gap-6">
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-1 text-sm text-muted border border-border rounded-lg px-3 py-2 w-fit hover:bg-surface-hover active:bg-surface-hover"
        >
          ← 대시보드로
        </Link>

        <header>
          <h1 className="text-2xl font-bold text-foreground">내 정보</h1>
        </header>

        <div className="bg-surface border border-border rounded-lg p-6 flex flex-col gap-6">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-full bg-surface-hover flex items-center justify-center overflow-hidden shrink-0">
              {profile?.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={profile.avatar_url}
                  alt={profile.display_name ?? user.email ?? ''}
                  className="w-full h-full object-cover"
                />
              ) : (
                <User size={28} className="text-muted" />
              )}
            </div>
            <div className="min-w-0">
              <p className="font-medium truncate">{profile?.display_name || user.email}</p>
              <p className="text-sm text-muted truncate">{user.email}</p>
              <p className="text-xs text-muted mt-1">프로필 사진 설정은 추후 지원 예정입니다.</p>
            </div>
          </div>

          <UpdateDisplayNameForm userId={user.id} initialDisplayName={profile?.display_name ?? null} />
        </div>

        <div className="bg-surface border border-border rounded-lg p-6">
          <ChangePasswordForm email={user.email} />
        </div>

        <DeleteAccountSection email={user.email} />
      </div>
    </main>
  );
}
