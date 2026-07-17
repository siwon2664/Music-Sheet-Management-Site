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
  const [copiedField, setCopiedField] = useState<'code' | 'link' | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const link = origin ? `${origin}/join/${token}` : '';

  async function handleCopy(value: string, field: 'code' | 'link') {
    if (!value) return;
    await navigator.clipboard.writeText(value);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  }

  async function handleRegenerate() {
    if (!confirm('팀 코드를 재발급할까요? 기존 코드와 링크는 더 이상 사용할 수 없게 됩니다.')) return;

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
        <h2 className="font-semibold text-sm">팀 코드</h2>
        <p className="text-xs text-gray-500 mt-0.5">
          이 코드를 팀원에게 알려주면 대시보드의 &quot;코드로 참여하기&quot;에서 바로 합류할 수 있습니다.
        </p>
      </div>

      <div className="flex items-center gap-2">
        <input
          type="text"
          readOnly
          value={token}
          onFocus={(e) => e.target.select()}
          className="flex-1 min-w-0 border rounded px-3 py-2 text-sm bg-gray-50 text-gray-600 font-mono"
        />
        <button
          type="button"
          onClick={() => handleCopy(token, 'code')}
          className="shrink-0 flex items-center gap-1.5 border rounded px-3 py-2 text-sm font-medium hover:bg-gray-50"
        >
          <Copy size={14} />
          {copiedField === 'code' ? '복사됨' : '복사'}
        </button>
        <button
          type="button"
          onClick={handleRegenerate}
          disabled={regenerating}
          className="shrink-0 flex items-center gap-1.5 border rounded px-3 py-2 text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
          title="팀 코드 재발급"
        >
          <RefreshCw size={14} />
        </button>
      </div>

      <div className="flex items-center gap-2">
        <input
          type="text"
          readOnly
          value={link}
          onFocus={(e) => e.target.select()}
          className="flex-1 min-w-0 border rounded px-3 py-2 text-xs bg-gray-50 text-gray-400"
        />
        <button
          type="button"
          onClick={() => handleCopy(link, 'link')}
          className="shrink-0 flex items-center gap-1.5 border rounded px-3 py-2 text-xs font-medium hover:bg-gray-50"
        >
          <Copy size={12} />
          {copiedField === 'link' ? '복사됨' : '링크 복사'}
        </button>
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
