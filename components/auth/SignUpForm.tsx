'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

interface SignUpFormProps {
  redirectTo?: string;
}

export default function SignUpForm({ redirectTo = '/dashboard' }: SignUpFormProps) {
  const router = useRouter();
  const supabase = createClient();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function handleSignUp(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);

    const { data, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { display_name: displayName || email.split('@')[0] },
        emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(redirectTo)}`,
      },
    });

    setLoading(false);

    if (signUpError) {
      setError(signUpError.message);
      return;
    }

    // 이메일 확인이 활성화된 프로젝트라면 세션이 바로 생기지 않을 수 있음
    if (data.session) {
      router.push(redirectTo);
      router.refresh();
    } else {
      setMessage('가입 확인 메일을 보냈습니다. 메일함을 확인해주세요.');
    }
  }

  return (
    <form onSubmit={handleSignUp} className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">회원가입</h2>

      <label className="flex flex-col gap-1 text-sm">
        이름
        <input
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="밴드에서 사용할 이름"
          className="border rounded px-3 py-2"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        이메일
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="border rounded px-3 py-2"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        비밀번호
        <input
          type="password"
          required
          minLength={6}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="border rounded px-3 py-2"
        />
      </label>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {message && <p className="text-sm text-green-600">{message}</p>}

      <button
        type="submit"
        disabled={loading}
        className="bg-black text-white rounded px-4 py-2 disabled:opacity-50"
      >
        {loading ? '가입 처리 중...' : '회원가입'}
      </button>
    </form>
  );
}
