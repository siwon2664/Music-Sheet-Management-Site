'use client';

import { useEffect, useState } from 'react';
import { Copy, RefreshCw } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

interface InviteLinkSectionProps {
  teamId: string;
  initialToken: string;
}

export default function InviteLinkSection({ teamId, initialToken }: InviteLinkSectionProps) {
  const supabase = createClient();

  const [token, setToken] = useState(initialToken);
  const [origin, setOrigin] = useState('');
  const [copied, setCopied] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const link = origin ? `${origin}/join/${token}` : '';

  async function handleCopy() {
    if (!link) return;
    await navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleRegenerate() {
    if (!confirm('초대 링크를 재발급할까요? 기존 링크는 더 이상 사용할 수 없게 됩니다.')) return;

    setRegenerating(true);
    setError(null);

    const { data, error: regenerateError } = await supabase.rpc('regenerate_invite_token', {
      p_team_id: teamId,
    });

    setRegenerating(false);

    if (regenerateError) {
      setError(regenerateError.message);
      return;
    }

    if (data) setToken(data);
  }

  return (
    <div className="bg-white border rounded-lg p-4 flex flex-col gap-3">
      <div>
        <h2 className="font-semibold text-sm">초대 링크</h2>
        <p className="text-xs text-gray-500 mt-0.5">
          이 링크를 공유하면 링크를 받은 사람이 팀원으로 바로 합류할 수 있습니다.
        </p>
      </div>

      <div className="flex items-center gap-2">
        <input
          type="text"
          readOnly
          value={link}
          onFocus={(e) => e.target.select()}
          className="flex-1 min-w-0 border rounded px-3 py-2 text-sm bg-gray-50 text-gray-600"
        />
        <button
          type="button"
          onClick={handleCopy}
          className="shrink-0 flex items-center gap-1.5 border rounded px-3 py-2 text-sm font-medium hover:bg-gray-50"
        >
          <Copy size={14} />
          {copied ? '복사됨' : '복사'}
        </button>
        <button
          type="button"
          onClick={handleRegenerate}
          disabled={regenerating}
          className="shrink-0 flex items-center gap-1.5 border rounded px-3 py-2 text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
          title="초대 링크 재발급"
        >
          <RefreshCw size={14} />
        </button>
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
