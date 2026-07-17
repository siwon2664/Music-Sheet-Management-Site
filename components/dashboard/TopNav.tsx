import Link from 'next/link';
import { Library, ListMusic } from 'lucide-react';
import ProfileMenu from '@/components/dashboard/ProfileMenu';
import type { TeamRole } from '@/types/supabase';

interface TopNavProps {
  teamName: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  role: TeamRole;
}

export default function TopNav({ teamName, email, displayName, avatarUrl, role }: TopNavProps) {
  return (
    <header className="border-b bg-white">
      <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 min-w-0">
          <ListMusic size={22} className="text-gray-800 shrink-0" />
          <div className="min-w-0 leading-tight">
            <h1 className="text-lg md:text-xl font-bold truncate">Band Setlist</h1>
            <p className="text-xs text-gray-400 truncate">{teamName}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <Link
            href="/dashboard/sheets"
            className="flex items-center gap-2 text-sm font-medium border rounded px-4 py-2 hover:bg-gray-50"
          >
            <Library size={16} />
            전체 악보 라이브러리
          </Link>
          <ProfileMenu email={email} displayName={displayName} avatarUrl={avatarUrl} role={role} />
        </div>
      </div>
    </header>
  );
}
