'use client';

import { useState } from 'react';
import type { FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

// 팀 코드뿐 아니라 초대 링크 전체를 붙여넣어도 동작하도록 토큰만 뽑아낸다.
function extractInviteToken(raw: string): string {
  const trimmed = raw.trim();
  const match = trimmed.match(/\/join\/([^/?#]+)/);
  return match ? match[1] : trimmed;
}

export default function JoinTeamByCodeForm() {
  const router = useRouter();
  const supabase = createClient();

  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleJoin(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const token = extractInviteToken(code);
    const { error: joinError } = await supabase.rpc('join_team_via_invite', { p_token: token });

    setLoading(false);

    if (joinError) {
      setError(joinError.message || '유효하지 않은 코드입니다. 코드를 다시 확인해주세요.');
      return;
    }

    router.push('/dashboard');
    router.refresh();
  }

  return (
    <form onSubmit={handleJoin} className="flex flex-col gap-4 max-w-sm mx-auto">
      <h2 className="text-lg font-semibold">코드로 참여하기</h2>

      <label className="flex flex-col gap-1 text-sm">
        팀 코드
        <input
          type="text"
          required
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="팀장에게 받은 코드를 입력하세요"
          className="border rounded px-3 py-2"
        />
      </label>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={loading}
        className="border rounded px-4 py-2 font-medium hover:bg-gray-50 disabled:opacity-50"
      >
        {loading ? '참여 중...' : '팀 참여하기'}
      </button>
    </form>
  );
}
