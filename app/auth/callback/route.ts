// 회원가입 이메일 확인 링크가 도착하는 곳.
// @supabase/ssr는 PKCE 플로우를 쓰므로 링크에 담긴 code를 세션으로 교환해야
// 인증 상태가 성립한다 (이 교환 없이는 쿠키가 생기지 않아 로그인 화면에 멈춘 것처럼 보임).
// 교환에 성공하면 세션이 바로 생기지만, 확인 직후 자동 로그인시키지 않고
// "회원가입 완료" 메시지와 함께 로그인 화면으로 보내 직접 로그인하게 한다.
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/dashboard';

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      await supabase.auth.signOut();
      return NextResponse.redirect(
        `${origin}/login?confirmed=1&redirect=${encodeURIComponent(next)}`
      );
    }
  }

  return NextResponse.redirect(`${origin}/login?error=confirm_failed`);
}
