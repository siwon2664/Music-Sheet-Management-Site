// 이메일 확인/초대 링크가 도착하는 곳.
// @supabase/ssr는 PKCE 플로우를 쓰므로 링크에 담긴 code를 세션으로 교환해야
// 로그인 상태가 성립한다 (이 교환 없이는 쿠키가 생기지 않아 로그인 화면에 멈춘 것처럼 보임).
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
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=confirm_failed`);
}
