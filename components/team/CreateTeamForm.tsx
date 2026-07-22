'use client';

import { useState } from 'react';
import type { FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export default function CreateTeamForm() {
  const router = useRouter();
  const supabase = createClient();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreateTeam(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const { data: team, error: rpcError } = await supabase.rpc('create_team', {
      p_name: name,
      p_description: description || undefined,
    });

    if (rpcError) {
      setLoading(false);
      setError(rpcError.message);
      return;
    }

    // 새로 만든 팀을 바로 활성 팀으로 지정해서, 대시보드로 돌아갔을 때
    // 방금 만든 팀이 아니라 이전에 쓰던 팀이 보이는 일이 없게 한다.
    await fetch('/api/teams/active', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ teamId: team.id }),
    });

    setLoading(false);
    router.push('/dashboard');
    router.refresh();
  }

  return (
    <form onSubmit={handleCreateTeam} className="flex flex-col gap-4 max-w-sm mx-auto">
      <h2 className="text-lg font-semibold">새 팀 만들기</h2>

      <label className="flex flex-col gap-1 text-sm">
        팀 이름
        <input
          type="text"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="예: 우리 밴드"
          className="border rounded px-3 py-2"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        소개 (선택)
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="border rounded px-3 py-2"
        />
      </label>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={loading}
        className="bg-black text-white rounded px-4 py-2 disabled:opacity-50"
      >
        {loading ? '생성 중...' : '팀 생성 (자동으로 팀장이 됩니다)'}
      </button>
    </form>
  );
}
