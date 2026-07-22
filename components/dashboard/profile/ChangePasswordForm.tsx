'use client';

import { useState, type FormEvent } from 'react';
import { createClient } from '@/lib/supabase/client';
import { PASSWORD_RULE_HINT, validatePassword } from '@/lib/password';

interface ChangePasswordFormProps {
  email: string;
}

export default function ChangePasswordForm({ email }: ChangePasswordFormProps) {
  const supabase = createClient();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newPasswordConfirm, setNewPasswordConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const liveNewPasswordError = newPassword.length > 0 ? validatePassword(newPassword) : null;
  const confirmMismatch = newPasswordConfirm.length > 0 && newPassword !== newPasswordConfirm;
  const confirmMatch = newPasswordConfirm.length > 0 && !confirmMismatch;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    const passwordError = validatePassword(newPassword);
    if (passwordError) {
      setError(passwordError);
      return;
    }

    if (newPassword !== newPasswordConfirm) {
      setError('새 비밀번호가 일치하지 않습니다.');
      return;
    }

    setLoading(true);

    // supabase-js에는 "현재 비밀번호 확인" 전용 API가 없어서, 같은 계정으로
    // 다시 로그인을 시도해보는 방식으로 현재 비밀번호가 맞는지 검증한다.
    const { error: verifyError } = await supabase.auth.signInWithPassword({
      email,
      password: currentPassword,
    });

    if (verifyError) {
      setLoading(false);
      setError('현재 비밀번호가 올바르지 않습니다.');
      return;
    }

    const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });

    setLoading(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    setSuccess(true);
    setCurrentPassword('');
    setNewPassword('');
    setNewPasswordConfirm('');
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 max-w-sm">
      <h2 className="text-sm font-semibold">비밀번호 변경</h2>

      <label className="flex flex-col gap-1 text-sm">
        현재 비밀번호
        <input
          type="password"
          required
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          className="border rounded px-3 py-2"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        새 비밀번호
        <input
          type="password"
          required
          minLength={8}
          maxLength={32}
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          className="border rounded px-3 py-2"
        />
        {newPassword.length === 0 ? (
          <span className="text-xs text-gray-400">{PASSWORD_RULE_HINT}</span>
        ) : liveNewPasswordError ? (
          <span className="text-xs text-red-600">{liveNewPasswordError}</span>
        ) : (
          <span className="text-xs text-green-600">사용할 수 있는 비밀번호입니다.</span>
        )}
      </label>

      <label className="flex flex-col gap-1 text-sm">
        새 비밀번호 확인
        <input
          type="password"
          required
          minLength={8}
          maxLength={32}
          value={newPasswordConfirm}
          onChange={(e) => setNewPasswordConfirm(e.target.value)}
          className="border rounded px-3 py-2"
        />
        {confirmMismatch && <span className="text-xs text-red-600">비밀번호가 일치하지 않습니다.</span>}
        {confirmMatch && <span className="text-xs text-green-600">비밀번호가 일치합니다.</span>}
      </label>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {success && <p className="text-sm text-green-600">비밀번호가 변경되었습니다.</p>}

      <button
        type="submit"
        disabled={loading}
        className="self-start bg-black text-white rounded px-4 py-2 text-sm font-medium disabled:opacity-50"
      >
        {loading ? '변경 중...' : '비밀번호 변경'}
      </button>
    </form>
  );
}
