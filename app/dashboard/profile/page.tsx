import Link from 'next/link';
import { User } from 'lucide-react';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import UpdateDisplayNameForm from '@/components/dashboard/profile/UpdateDisplayNameForm';

export default async function ProfilePage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const { data: profile } = await supabase
    .from('users')
    .select('display_name, avatar_url')
    .eq('id', user.id)
    .single();

  return (
    <main className="min-h-screen bg-gray-50 p-4 md:p-6">
      <div className="max-w-lg w-full mx-auto flex flex-col gap-6">
        <Link href="/dashboard" className="text-sm text-gray-500 underline w-fit">
          ← 대시보드로
        </Link>

        <header>
          <h1 className="text-2xl font-bold">내 정보</h1>
        </header>

        <div className="bg-white border rounded-lg p-6 flex flex-col gap-6">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-full bg-gray-200 flex items-center justify-center overflow-hidden shrink-0">
              {profile?.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={profile.avatar_url}
                  alt={profile.display_name ?? user.email ?? ''}
                  className="w-full h-full object-cover"
                />
              ) : (
                <User size={28} className="text-gray-400" />
              )}
            </div>
            <div className="min-w-0">
              <p className="font-medium truncate">{profile?.display_name || user.email}</p>
              <p className="text-sm text-gray-500 truncate">{user.email}</p>
              <p className="text-xs text-gray-400 mt-1">프로필 사진 설정은 추후 지원 예정입니다.</p>
            </div>
          </div>

          <UpdateDisplayNameForm userId={user.id} initialDisplayName={profile?.display_name ?? null} />
        </div>
      </div>
    </main>
  );
}
