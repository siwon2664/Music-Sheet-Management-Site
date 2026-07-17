import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import SetlistEditor from '@/components/dashboard/setlist-editor/SetlistEditor';
import type { LibrarySheet } from '@/components/dashboard/setlist-editor/SheetLibraryPanel';
import type { SetlistItem } from '@/components/dashboard/setlist-editor/SetlistPanel';

export default async function SetlistDetailPage({ params }: { params: { id: string } }) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const { data: setlist } = await supabase
    .from('setlists')
    .select('id, title, description, event_date, team_id')
    .eq('id', params.id)
    .single();

  if (!setlist) {
    notFound();
  }

  const { data: membership } = await supabase
    .from('team_members')
    .select('role')
    .eq('team_id', setlist.team_id)
    .eq('user_id', user.id)
    .maybeSingle();

  const [{ data: sheets }, { data: setlistSheets }] = await Promise.all([
    supabase
      .from('sheets')
      .select('id, title, composer, key, bpm, tags, file_url')
      .eq('team_id', setlist.team_id)
      .order('title', { ascending: true }),
    supabase
      .from('setlist_sheets')
      .select('id, sheet_id, sort_order, transposed_key, note, song_form')
      .eq('setlist_id', setlist.id)
      .order('sort_order', { ascending: true }),
  ]);

  const librarySheets: LibrarySheet[] = sheets ?? [];
  const sheetById = new Map(librarySheets.map((sheet) => [sheet.id, sheet]));

  const initialItems: SetlistItem[] = (setlistSheets ?? [])
    .map((row) => {
      const sheet = sheetById.get(row.sheet_id);
      if (!sheet) return null;
      const item: SetlistItem = {
        id: row.id,
        sheetId: row.sheet_id,
        title: sheet.title,
        originalKey: sheet.key,
        transposedKey: row.transposed_key,
        note: row.note ?? '',
        fileUrl: sheet.file_url,
        songForm: row.song_form ?? [],
      };
      return item;
    })
    .filter((item): item is SetlistItem => item !== null);

  const dateLabel = setlist.event_date
    ? new Date(`${setlist.event_date}T00:00:00`).toLocaleDateString('ko-KR', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        weekday: 'short',
      })
    : null;

  return (
    <main className="min-h-screen bg-gray-50 p-4 md:p-6">
      <div className="max-w-6xl w-full mx-auto flex flex-col gap-4">
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-1 text-sm text-gray-600 border rounded-lg px-3 py-2 w-fit hover:bg-gray-50 active:bg-gray-100"
        >
          ← 대시보드로
        </Link>

        <header>
          {dateLabel && <p className="text-sm text-gray-500">{dateLabel}</p>}
          <h1 className="text-2xl font-bold">{setlist.title}</h1>
          {setlist.description && (
            <p className="text-gray-700 whitespace-pre-wrap mt-1">{setlist.description}</p>
          )}
        </header>

        <SetlistEditor
          setlistId={setlist.id}
          setlistTitle={setlist.title}
          teamId={setlist.team_id}
          role={membership?.role ?? 'MEMBER'}
          sheets={librarySheets}
          initialItems={initialItems}
        />
      </div>
    </main>
  );
}
