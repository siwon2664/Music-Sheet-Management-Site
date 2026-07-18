'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { X } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

interface CreateFixedSetlistModalProps {
  teamId: string;
  onClose: () => void;
}

export default function CreateFixedSetlistModal({ teamId, onClose }: CreateFixedSetlistModalProps) {
  const router = useRouter();
  const supabase = createClient();

  const [title, setTitle] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

    const { data: setlist, error: insertError } = await supabase
      .from('setlists')
      .insert({
        team_id: teamId,
        title,
        event_date: null,
        created_by: user.id,
      })
      .select('id')
      .single();

    setLoading(false);

    if (insertError) {
      setError(insertError.message);
      return;
    }

    router.push(`/dashboard/setlist/${setlist.id}`);
    router.refresh();
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

        <h2 className="text-lg font-semibold mb-1">고정 콘티 만들기</h2>
        <p className="text-sm text-gray-500 mb-4">날짜에 상관없이 항상 목록에 고정되는 콘티입니다.</p>

        <form onSubmit={handleCreate} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm">
            콘티 제목
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="예: 매주 쓰는 콘티~"
              className="border rounded px-3 py-2"
              autoFocus
            />
          </label>

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
