'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { X } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { getDefaultSetlistTitle } from '@/lib/setlist';
import type { SheetRow } from './SheetsLibraryClient';

interface CreateSetlistFromSelectionModalProps {
  teamId: string;
  sheets: SheetRow[];
  onClose: () => void;
}

function todayIso() {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export default function CreateSetlistFromSelectionModal({
  teamId,
  sheets,
  onClose,
}: CreateSetlistFromSelectionModalProps) {
  const router = useRouter();
  const supabase = createClient();

  const [date, setDate] = useState(todayIso());
  const [title, setTitle] = useState(() => getDefaultSetlistTitle(todayIso()));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleDateChange(value: string) {
    setDate(value);
    setTitle(getDefaultSetlistTitle(value));
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setLoading(false);
      setError('로그인이 필요합니다.');
      return;
    }

    const { data: setlist, error: setlistError } = await supabase
      .from('setlists')
      .insert({
        team_id: teamId,
        title,
        event_date: date,
        created_by: user.id,
      })
      .select('id')
      .single();

    if (setlistError) {
      setLoading(false);
      setError(setlistError.message);
      return;
    }

    const { error: mappingError } = await supabase.from('setlist_sheets').insert(
      sheets.map((sheet, index) => ({
        setlist_id: setlist.id,
        sheet_id: sheet.id,
        team_id: teamId,
        sort_order: index,
      }))
    );

    setLoading(false);

    if (mappingError) {
      setError(mappingError.message);
      return;
    }

    router.push(`/dashboard/setlist/${setlist.id}`);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-lg shadow-lg w-full max-w-sm p-6 relative">
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-400 hover:text-gray-600"
          aria-label="닫기"
        >
          <X size={18} />
        </button>

        <h2 className="text-lg font-semibold mb-1">이 곡들로 콘티 만들기</h2>
        <p className="text-sm text-gray-500 mb-4">선택한 {sheets.length}곡이 순서대로 담깁니다.</p>

        <form onSubmit={handleCreate} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm">
            날짜
            <input
              type="date"
              required
              value={date}
              onChange={(e) => handleDateChange(e.target.value)}
              className="border rounded px-3 py-2"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            콘티 제목
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="border rounded px-3 py-2"
            />
          </label>

          <ul className="text-xs text-gray-500 border rounded px-3 py-2 max-h-32 overflow-y-auto flex flex-col gap-1">
            {sheets.map((sheet, index) => (
              <li key={sheet.id}>
                {index + 1}. {sheet.title}
              </li>
            ))}
          </ul>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex gap-2 justify-end mt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded px-4 py-2 text-sm border hover:bg-gray-50"
            >
              취소
            </button>
            <button
              type="submit"
              disabled={loading}
              className="bg-black text-white rounded px-4 py-2 text-sm disabled:opacity-50"
            >
              {loading ? '생성 중...' : '콘티 생성'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
