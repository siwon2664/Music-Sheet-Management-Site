import Link from 'next/link';
import LoginForm from '@/components/auth/LoginForm';

export default function LoginPage({
  searchParams,
}: {
  searchParams: { redirect?: string };
}) {
  const redirectTo = searchParams.redirect || '/dashboard';

  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-4 p-8">
      <LoginForm redirectTo={redirectTo} />
      <p className="text-sm text-gray-500">
        계정이 없으신가요?{' '}
        <Link href={`/signup?redirect=${encodeURIComponent(redirectTo)}`} className="underline">
          회원가입
        </Link>
      </p>
    </main>
  );
}
