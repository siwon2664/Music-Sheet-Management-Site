'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

interface JoinTeamButtonProps {
  token: string;
}

export default function JoinTeamButton({ token }: JoinTeamButtonProps) {
  const router = useRouter();
  const supabase = createClient();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleJoin() {
    setLoading(true);
    setError(null);

    const { data: teamId, error: joinError } = await supabase.rpc('join_team_via_invite', {
      p_token: token,
    });

    if (joinError) {
      setLoading(false);
      setError(joinError.message);
      return;
    }

    await fetch('/api/teams/active', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ teamId }),
    });

    setLoading(false);
    router.push('/dashboard');
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3">
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        type="button"
        onClick={handleJoin}
        disabled={loading}
        className="bg-black text-white rounded px-4 py-2 text-sm font-medium disabled:opacity-50"
      >
        {loading ? '참여 중...' : '참여하기'}
      </button>
    </div>
  );
}
