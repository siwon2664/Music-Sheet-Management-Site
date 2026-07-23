import fs from 'node:fs';
import path from 'node:path';
import Link from 'next/link';
import SignUpForm from '@/components/auth/SignUpForm';
import AuthBrandHeader from '@/components/auth/AuthBrandHeader';

export default function SignUpPage({
  searchParams,
}: {
  searchParams: { redirect?: string };
}) {
  const redirectTo = searchParams.redirect || '/dashboard';

  const termsText = fs.readFileSync(path.join(process.cwd(), 'docs/terms-of-service.md'), 'utf-8');
  const privacyText = fs.readFileSync(path.join(process.cwd(), 'docs/privacy-policy.md'), 'utf-8');

  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-8 p-8 bg-gray-50">
      <AuthBrandHeader />

      <div className="w-full max-w-sm bg-white border rounded-lg shadow-sm p-6">
        <SignUpForm redirectTo={redirectTo} termsText={termsText} privacyText={privacyText} />
      </div>

      <p className="text-sm text-gray-500">
        이미 계정이 있으신가요?{' '}
        <Link href={`/login?redirect=${encodeURIComponent(redirectTo)}`} className="underline">
          로그인
        </Link>
      </p>
    </main>
  );
}
