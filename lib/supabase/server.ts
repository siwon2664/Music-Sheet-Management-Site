// lib/supabase/server.ts
// Server Component, Server Action, Route Handler(app/api/**)에서 사용하는 Supabase 클라이언트
// 쿠키 기반으로 세션을 읽어 인증된 요청을 만들어준다.

import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { cache } from 'react';
import type { Database } from '@/types/supabase';

// cache: 한 요청을 그리는 동안 레이아웃과 페이지가 같은 클라이언트와 조회 결과를 함께 쓴다.
export const createClient = cache(async () => {
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
});

export const getCurrentUser = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});
