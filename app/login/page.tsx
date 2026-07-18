import Link from 'next/link';
import LoginForm from '@/components/auth/LoginForm';
import AuthBrandHeader from '@/components/auth/AuthBrandHeader';

export default function LoginPage({
  searchParams,
}: {
  searchParams: { redirect?: string; confirmed?: string };
}) {
  const redirectTo = searchParams.redirect || '/dashboard';

  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-8 p-8 bg-gray-50">
      <AuthBrandHeader />

      <div className="w-full max-w-sm bg-white border rounded-lg shadow-sm p-6">
        {searchParams.confirmed && (
          <p className="text-sm text-green-600 mb-4">회원가입이 완료되었습니다. 로그인해주세요.</p>
        )}
        <LoginForm redirectTo={redirectTo} />
      </div>

      <p className="text-sm text-gray-500">
        계정이 없으신가요?{' '}
        <Link href={`/signup?redirect=${encodeURIComponent(redirectTo)}`} className="underline">
          회원가입
        </Link>
      </p>
    </main>
  );
}
