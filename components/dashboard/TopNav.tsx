import Link from 'next/link';
import { Library, ListMusic } from 'lucide-react';
import ProfileMenu from '@/components/dashboard/ProfileMenu';
import TeamSwitcher from '@/components/dashboard/TeamSwitcher';
import type { UserTeam } from '@/lib/activeTeam';
import type { TeamRole } from '@/types/supabase';

interface TopNavProps {
  teamName: string;
  teams: UserTeam[];
  activeTeamId: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  role: TeamRole;
}

export default function TopNav({
  teamName,
  teams,
  activeTeamId,
  email,
  displayName,
  avatarUrl,
  role,
}: TopNavProps) {
  return (
    <header className="border-b border-border bg-surface text-foreground">
      <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 min-w-0">
          <ListMusic size={22} className="text-foreground shrink-0" />
          <TeamSwitcher teamName={teamName} teams={teams} activeTeamId={activeTeamId} />
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {/*
            악보 라이브러리 링크는 lg 미만(태블릿/모바일)에서는 하단
            탭바(MobileBottomNav)가 대신하므로 거기서만 숨긴다. 프로필은
            원래대로 화면 크기 상관없이 항상 오른쪽 위에 그대로 둔다.
          */}
          <Link
            href="/dashboard/sheets"
            className="hidden lg:flex items-center gap-2 text-sm font-medium border border-border rounded px-4 py-2 hover:bg-surface-hover"
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
