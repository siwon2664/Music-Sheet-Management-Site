import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import SheetsLibraryClient from '@/components/sheets/SheetsLibraryClient';

export default async function SheetsLibraryPage() {
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

  if (!membership) {
    redirect('/dashboard');
  }

  const { data: sheets } = await supabase
    .from('sheets')
    .select('id, title, composer, key, bpm, tags, file_url, thumbnail_url, created_at')
    .eq('team_id', membership.team_id)
    .order('title', { ascending: true });

  return (
    <main className="min-h-screen bg-gray-50 p-4 md:p-6">
      <div className="max-w-5xl w-full mx-auto flex flex-col gap-4">
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-1 text-sm text-gray-600 border rounded-lg px-3 py-2 w-fit hover:bg-gray-50 active:bg-gray-100"
        >
          ← 대시보드로
        </Link>

        <header>
          <h1 className="text-2xl font-bold">악보 라이브러리</h1>
        </header>

        <SheetsLibraryClient
          teamId={membership.team_id}
          role={membership.role}
          initialSheets={sheets ?? []}
        />
      </div>
    </main>
  );
}
