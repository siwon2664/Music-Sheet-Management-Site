'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Building2, LogOut, Settings, User, Users } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import type { TeamRole } from '@/types/supabase';

interface ProfileMenuProps {
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  role: TeamRole;
}

export default function ProfileMenu({ email, displayName, avatarUrl, role }: ProfileMenuProps) {
  const router = useRouter();
  const supabase = createClient();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  async function handleLogout() {
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="w-9 h-9 rounded-full bg-gray-200 flex items-center justify-center overflow-hidden shrink-0 hover:ring-2 hover:ring-gray-300"
        aria-label="프로필 메뉴"
      >
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={avatarUrl} alt={displayName ?? email} className="w-full h-full object-cover" />
        ) : (
          <User size={18} className="text-gray-500" />
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-56 bg-white border rounded-lg shadow-lg py-1 z-50">
          <div className="px-4 py-2 border-b">
            <p className="text-sm font-medium truncate">{displayName || email}</p>
            <p className="text-xs text-gray-500 truncate">{email}</p>
          </div>

          <Link
            href="/dashboard/profile"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-4 py-2 text-sm hover:bg-gray-50"
          >
            <User size={14} />내 정보
          </Link>

          <Link
            href="/dashboard/settings"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-4 py-2 text-sm hover:bg-gray-50"
          >
            <Settings size={14} />
            설정
          </Link>

          <Link
            href="/dashboard/teams/manage"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-4 py-2 text-sm hover:bg-gray-50"
          >
            <Building2 size={14} />팀 관리
          </Link>

          {role === 'LEADER' && (
            <Link
              href="/dashboard/members"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 px-4 py-2 text-sm hover:bg-gray-50"
            >
              <Users size={14} />
              멤버 관리
            </Link>
          )}

          <button
            type="button"
            onClick={handleLogout}
            className="w-full flex items-center gap-2 px-4 py-2 text-sm text-red-600 hover:bg-red-50 border-t"
          >
            <LogOut size={14} />
            로그아웃
          </button>
        </div>
      )}
    </div>
  );
}
