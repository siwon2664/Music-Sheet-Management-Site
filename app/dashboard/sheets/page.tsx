import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { resolveActiveTeam } from '@/lib/activeTeam';
import SheetsLibraryClient from '@/components/sheets/SheetsLibraryClient';

export default async function SheetsLibraryPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const { activeTeam } = await resolveActiveTeam(supabase, user.id);

  if (!activeTeam) {
    redirect('/dashboard');
  }

  const { data: sheets } = await supabase
    .from('sheets')
    .select('id, title, composer, key, bpm, tags, file_url, thumbnail_url, created_at')
    .eq('team_id', activeTeam.id)
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
          teamId={activeTeam.id}
          role={activeTeam.role}
          initialSheets={sheets ?? []}
        />
      </div>
    </main>
  );
}
