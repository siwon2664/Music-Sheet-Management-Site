'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

interface UpdateDisplayNameFormProps {
  userId: string;
  initialDisplayName: string | null;
}

export default function UpdateDisplayNameForm({ userId, initialDisplayName }: UpdateDisplayNameFormProps) {
  const router = useRouter();
  const supabase = createClient();

  const [displayName, setDisplayName] = useState(initialDisplayName ?? '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSaved(false);

    const { error: updateError } = await supabase
      .from('users')
      .update({ display_name: displayName || null })
      .eq('id', userId);

    setLoading(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    setSaved(true);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 max-w-sm">
      <label className="flex flex-col gap-1 text-sm">
        표시 이름
        <input
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="밴드에서 사용할 이름"
          className="border rounded px-3 py-2"
        />
      </label>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {saved && <p className="text-sm text-green-600">저장됐습니다.</p>}

      <button
        type="submit"
        disabled={loading}
        className="self-start bg-black text-white rounded px-4 py-2 text-sm font-medium disabled:opacity-50"
      >
        {loading ? '저장 중...' : '저장'}
      </button>
    </form>
  );
}
