// lib/supabase/client.ts
// 클라이언트 컴포넌트("use client")에서 사용하는 Supabase 브라우저 클라이언트
// 설치: npm install @supabase/ssr @supabase/supabase-js

import { createBrowserClient } from '@supabase/ssr';
import type { Database } from '@/types/supabase';

export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
