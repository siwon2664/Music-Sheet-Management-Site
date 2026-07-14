import Link from 'next/link';
import SignUpForm from '@/components/auth/SignUpForm';

export default function SignUpPage({
  searchParams,
}: {
  searchParams: { redirect?: string };
}) {
  const redirectTo = searchParams.redirect || '/dashboard';

  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-4 p-8">
      <SignUpForm redirectTo={redirectTo} />
      <p className="text-sm text-gray-500">
        이미 계정이 있으신가요?{' '}
        <Link href={`/login?redirect=${encodeURIComponent(redirectTo)}`} className="underline">
          로그인
        </Link>
      </p>
    </main>
  );
}
