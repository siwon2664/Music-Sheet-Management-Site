import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export default async function SettingsPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  return (
    <main className="min-h-screen bg-gray-50 p-4 md:p-6">
      <div className="max-w-lg w-full mx-auto flex flex-col gap-6">
        <Link href="/dashboard" className="text-sm text-gray-500 underline w-fit">
          ← 대시보드로
        </Link>

        <header>
          <h1 className="text-2xl font-bold">설정</h1>
        </header>

        <div className="bg-white border rounded-lg p-6">
          <p className="text-sm text-gray-500">설정 항목은 준비 중입니다.</p>
        </div>
      </div>
    </main>
  );
}
