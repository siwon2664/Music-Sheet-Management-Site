// lib/supabase/server.ts
// Server Component, Server Action, Route Handler(app/api/**)에서 사용하는 Supabase 클라이언트
// 쿠키 기반으로 세션을 읽어 인증된 요청을 만들어준다.

import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { Database } from '@/types/supabase';

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options as CookieOptions);
            });
          } catch {
            // Server Component 내부에서 호출될 경우 무시해도 됨
            // (middleware에서 세션 갱신을 이미 처리하기 때문)
          }
        },
      },
    }
  );
}
