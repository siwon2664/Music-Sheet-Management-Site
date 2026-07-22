'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Trash2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

interface DeleteAccountSectionProps {
  email: string;
}

export default function DeleteAccountSection({ email }: DeleteAccountSectionProps) {
  const router = useRouter();
  const supabase = createClient();

  const [expanded, setExpanded] = useState(false);
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    // 여기서도 "현재 비밀번호 확인"은 재로그인 시도로 대신한다.
    const { error: verifyError } = await supabase.auth.signInWithPassword({ email, password });

    if (verifyError) {
      setLoading(false);
      setError('비밀번호가 올바르지 않습니다.');
      return;
    }

    const { error: rpcError } = await supabase.rpc('delete_own_account');

    if (rpcError) {
      setLoading(false);
      setError(rpcError.message);
      return;
    }

    await supabase.auth.signOut();
    router.push('/login?deleted=1');
    router.refresh();
  }

  if (!expanded) {
    return (
      <div className="border border-red-200 rounded-lg p-4 flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-red-600">회원 탈퇴</p>
          <p className="text-xs text-gray-500 mt-0.5">계정을 삭제하면 되돌릴 수 없습니다.</p>
        </div>
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="flex items-center gap-1.5 shrink-0 text-sm border border-red-200 text-red-600 rounded px-3 py-2 hover:bg-red-50"
        >
          <Trash2 size={14} />
          회원 탈퇴
        </button>
      </div>
    );
  }

  return (
    <div className="border border-red-200 rounded-lg p-4 flex flex-col gap-4">
      <div className="flex items-start gap-2 text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2.5">
        <AlertTriangle size={16} className="shrink-0 mt-0.5" />
        <ul className="text-xs leading-relaxed list-disc pl-4 space-y-0.5">
          <li>탈퇴하면 계정과 로그인 정보가 즉시 삭제되며 되돌릴 수 없습니다.</li>
          <li>가입한 모든 팀에서 탈퇴되고, 직접 그린 필기(마킹)도 함께 삭제됩니다.</li>
          <li>업로드한 악보·콘티는 팀에 그대로 남을 수 있습니다(작성자 정보만 사라짐).</li>
          <li>본인이 개설한 팀이 있다면, 팀 관리에서 그 팀을 먼저 삭제해야 탈퇴할 수 있습니다.</li>
        </ul>
      </div>

      <form onSubmit={handleDelete} className="flex flex-col gap-3 max-w-sm">
        <label className="flex flex-col gap-1 text-sm">
          비밀번호 확인
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="border rounded px-3 py-2"
          />
        </label>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex items-center gap-2">
          <button
            type="submit"
            disabled={loading}
            className="bg-red-600 text-white rounded px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            {loading ? '탈퇴 처리 중...' : '탈퇴하기'}
          </button>
          <button
            type="button"
            onClick={() => {
              setExpanded(false);
              setPassword('');
              setError(null);
            }}
            disabled={loading}
            className="text-sm text-gray-500 hover:text-gray-900 disabled:opacity-50"
          >
            취소
          </button>
        </div>
      </form>
    </div>
  );
}
