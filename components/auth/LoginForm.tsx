'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

interface LoginFormProps {
  redirectTo?: string;
}

export default function LoginForm({ redirectTo = '/dashboard' }: LoginFormProps) {
  const router = useRouter();
  const supabase = createClient();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleLogin(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    setLoading(false);

    if (signInError) {
      setError(signInError.message);
      return;
    }

    // 로그인 완료 -> 대시보드(또는 초대 링크 등 원래 가려던 곳)로 이동
    router.push(redirectTo);
    router.refresh();
  }

  return (
    <form onSubmit={handleLogin} className="flex flex-col gap-4 max-w-sm mx-auto">
      <h1 className="text-xl font-semibold">로그인</h1>

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
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="border rounded px-3 py-2"
        />
      </label>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={loading}
        className="bg-black text-white rounded px-4 py-2 disabled:opacity-50"
      >
        {loading ? '로그인 중...' : '로그인'}
      </button>
    </form>
  );
}
