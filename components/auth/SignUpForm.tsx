'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { PASSWORD_RULE_HINT, validatePassword } from '@/lib/password';
import TermsAgreementModal from './TermsAgreementModal';
import type { AuthError } from '@supabase/supabase-js';

interface SignUpFormProps {
  redirectTo?: string;
  termsText: string;
  privacyText: string;
}

// Supabase가 서버 쪽 문제(대표적으로 확인 이메일 발송 실패)로 실패할 때는
// error.message가 비어 있거나 "{}"처럼 알아볼 수 없는 값으로 오는 경우가 있다.
// 그럴 땐 원인 불명 문자열을 그대로 보여주는 대신 안내 문구로 대체한다.
function describeAuthError(err: AuthError, fallback: string): string {
  const message = err.message?.trim();
  if (!message || message === '{}') {
    return fallback;
  }
  return message;
}

export default function SignUpForm({ redirectTo = '/dashboard', termsText, privacyText }: SignUpFormProps) {
  const router = useRouter();
  const supabase = createClient();

  // 폼을 채우기 전에 약관 동의부터 받는다. 동의해야 입력 단계로 넘어간다.
  const [step, setStep] = useState<'terms' | 'form' | 'verify'>('terms');

  const [email, setEmail] = useState('');
  const [emailCheck, setEmailCheck] = useState<'idle' | 'checking' | 'available' | 'taken'>('idle');
  const [emailCheckError, setEmailCheckError] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // 인증 코드 입력 단계 상태
  const [code, setCode] = useState('');
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [resendLoading, setResendLoading] = useState(false);

  function handleSignUpSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);

    const passwordError = validatePassword(password);
    if (passwordError) {
      setError(passwordError);
      return;
    }

    if (password !== passwordConfirm) {
      setError('비밀번호가 일치하지 않습니다.');
      return;
    }

    performSignUp();
  }

  function handleAgreeTerms() {
    setStep('form');
  }

  async function performSignUp() {
    setLoading(true);

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
      setError(describeAuthError(signUpError, '가입 처리 중 문제가 발생했습니다. 잠시 후 다시 시도해주세요.'));
      return;
    }

    // Supabase는 이미 가입(확인 완료)된 이메일로 signUp을 다시 호출해도 에러를 주지 않는다
    // (이메일 존재 여부 유출 방지). 대신 이 경우 identities가 빈 배열로 온다 — 이게 유일한 신호.
    if (data.user && data.user.identities && data.user.identities.length === 0) {
      setError('이미 가입된 이메일입니다. 로그인해주세요.');
      return;
    }

    // 이메일 확인이 활성화된 프로젝트라면 세션이 바로 생기지 않고,
    // 대신 이메일로 받은 인증 코드를 입력하는 단계로 넘어간다.
    if (data.session) {
      router.push(redirectTo);
      router.refresh();
    } else {
      setStep('verify');
    }
  }

  async function handleCheckEmail() {
    if (!email) return;

    setEmailCheck('checking');
    setEmailCheckError(null);

    const { data, error: rpcError } = await supabase.rpc('email_exists', { p_email: email });

    if (rpcError) {
      setEmailCheck('idle');
      setEmailCheckError('중복 확인 중 문제가 발생했습니다. 잠시 후 다시 시도해주세요.');
      return;
    }

    setEmailCheck(data ? 'taken' : 'available');
  }

  async function handleVerifyCode(e: FormEvent) {
    e.preventDefault();
    setVerifyError(null);
    setVerifyLoading(true);

    const { error: verifyErr } = await supabase.auth.verifyOtp({
      email,
      token: code.trim(),
      type: 'signup',
    });

    setVerifyLoading(false);

    if (verifyErr) {
      setVerifyError(
        describeAuthError(verifyErr, '인증 코드가 올바르지 않거나 만료되었습니다. 다시 확인해주세요.')
      );
      return;
    }

    // 인증 직후 자동 로그인되지만, 기존 흐름과 동일하게 로그아웃 후 로그인 화면으로 보낸다.
    await supabase.auth.signOut();
    router.push(`/login?confirmed=1&redirect=${encodeURIComponent(redirectTo)}`);
  }

  async function handleResendCode() {
    setVerifyError(null);
    setResendLoading(true);

    const { error: resendErr } = await supabase.auth.resend({
      type: 'signup',
      email,
    });

    setResendLoading(false);

    if (resendErr) {
      setVerifyError(describeAuthError(resendErr, '인증 코드 재전송에 실패했습니다. 잠시 후 다시 시도해주세요.'));
      return;
    }

    setMessage('인증 코드를 다시 보냈습니다.');
  }

  if (step === 'terms') {
    return (
      <TermsAgreementModal
        termsText={termsText}
        privacyText={privacyText}
        loading={false}
        onAgree={handleAgreeTerms}
        onCancel={() => router.push('/login')}
      />
    );
  }

  if (step === 'verify') {
    return (
      <form onSubmit={handleVerifyCode} className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold">이메일 인증</h2>
        <p className="text-sm text-gray-500">
          <strong>{email}</strong>로 인증 코드를 보냈습니다. 메일함(스팸함 포함)에서 코드를 확인해주세요.
        </p>

        <label className="flex flex-col gap-1 text-sm">
          인증 코드
          <input
            type="text"
            inputMode="numeric"
            required
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="6자리 코드"
            className="border rounded px-3 py-2 tracking-widest"
          />
        </label>

        {verifyError && <p className="text-sm text-red-600">{verifyError}</p>}
        {message && <p className="text-sm text-green-600">{message}</p>}

        <button
          type="submit"
          disabled={verifyLoading}
          className="bg-black text-white rounded px-4 py-2 disabled:opacity-50"
        >
          {verifyLoading ? '확인 중...' : '인증하기'}
        </button>

        <button
          type="button"
          onClick={handleResendCode}
          disabled={resendLoading}
          className="text-sm text-gray-500 underline disabled:opacity-50"
        >
          {resendLoading ? '재전송 중...' : '코드 다시 받기'}
        </button>
      </form>
    );
  }

  // 제출을 눌러야만 알 수 있던 검증 결과를, 입력할 때마다 바로바로 보여준다.
  const livePasswordError = password.length > 0 ? validatePassword(password) : null;
  const passwordConfirmMismatch = passwordConfirm.length > 0 && password !== passwordConfirm;
  const passwordConfirmMatch = passwordConfirm.length > 0 && !passwordConfirmMismatch;

  return (
    <form onSubmit={handleSignUpSubmit} className="flex flex-col gap-4">
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
        <div className="flex gap-2">
          <input
            type="email"
            required
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setEmailCheck('idle');
              setEmailCheckError(null);
            }}
            className="border rounded px-3 py-2 flex-1"
          />
          <button
            type="button"
            onClick={handleCheckEmail}
            disabled={!email || emailCheck === 'checking'}
            className="border rounded px-3 py-2 text-sm whitespace-nowrap hover:bg-gray-50 disabled:opacity-50"
          >
            {emailCheck === 'checking' ? '확인 중...' : '중복확인'}
          </button>
        </div>
        {emailCheck === 'taken' && <span className="text-xs text-red-600">이미 사용중인 이메일입니다.</span>}
        {emailCheck === 'available' && (
          <span className="text-xs text-green-600">사용 가능한 이메일입니다.</span>
        )}
        {emailCheckError && <span className="text-xs text-red-600">{emailCheckError}</span>}
      </label>

      <label className="flex flex-col gap-1 text-sm">
        비밀번호
        <input
          type="password"
          required
          minLength={8}
          maxLength={32}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="border rounded px-3 py-2"
        />
        {password.length === 0 ? (
          <span className="text-xs text-gray-400">{PASSWORD_RULE_HINT}</span>
        ) : livePasswordError ? (
          <span className="text-xs text-red-600">{livePasswordError}</span>
        ) : (
          <span className="text-xs text-green-600">사용할 수 있는 비밀번호입니다.</span>
        )}
      </label>

      <label className="flex flex-col gap-1 text-sm">
        비밀번호 확인
        <input
          type="password"
          required
          minLength={8}
          maxLength={32}
          value={passwordConfirm}
          onChange={(e) => setPasswordConfirm(e.target.value)}
          className="border rounded px-3 py-2"
        />
        {passwordConfirmMismatch && (
          <span className="text-xs text-red-600">비밀번호가 일치하지 않습니다.</span>
        )}
        {passwordConfirmMatch && <span className="text-xs text-green-600">비밀번호가 일치합니다.</span>}
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
