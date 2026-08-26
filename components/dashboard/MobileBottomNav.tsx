'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Calendar, Library } from 'lucide-react';

// 태블릿/모바일 전용 하단 탭바 (lg 이상 데스크톱에서는 기존 TopNav를 그대로 씀).
// 프로필은 여기 넣지 않고 기존처럼 오른쪽 위 ProfileMenu 그대로 둔다.
export default function MobileBottomNav() {
  const pathname = usePathname();

  const isMain = pathname === '/dashboard';
  const isSheets = pathname.startsWith('/dashboard/sheets');

  return (
    <nav
      className="fixed bottom-0 inset-x-0 z-40 bg-surface border-t border-border flex items-stretch lg:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <Link
        href="/dashboard"
        className={`flex-1 flex flex-col items-center justify-center gap-0.5 py-2 text-xs ${
          isMain ? 'text-foreground font-semibold' : 'text-muted'
        }`}
      >
        <Calendar size={20} />
        Main
      </Link>

      <Link
        href="/dashboard/sheets"
        className={`flex-1 flex flex-col items-center justify-center gap-0.5 py-2 text-xs ${
          isSheets ? 'text-foreground font-semibold' : 'text-muted'
        }`}
      >
        <Library size={20} />
        악보
      </Link>
    </nav>
  );
}
