'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, ChevronDown } from 'lucide-react';
import type { UserTeam } from '@/lib/activeTeam';

interface TeamSwitcherProps {
  teamName: string;
  teams: UserTeam[];
  activeTeamId: string;
}

export default function TeamSwitcher({ teamName, teams, activeTeamId }: TeamSwitcherProps) {
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  async function switchTeam(teamId: string) {
    if (teamId === activeTeamId || switching) {
      setOpen(false);
      return;
    }

    setSwitching(true);

    // Supabase RLS 정책은 요청을 보내는 클라이언트의 세션만 확인할 뿐 "활성 팀"
    // 개념을 모르기 때문에, 어떤 팀을 활성으로 볼지는 서버 쿠키로 별도 관리한다.
    await fetch('/api/teams/active', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ teamId }),
    });

    setOpen(false);
    setSwitching(false);
    router.push('/dashboard');
    router.refresh();
  }

  return (
    <div className="relative min-w-0" ref={menuRef}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex items-center gap-1.5 min-w-0 text-left rounded hover:bg-gray-50 -mx-1 px-1 py-0.5"
      >
        <div className="min-w-0 leading-tight">
          <h1 className="text-lg md:text-xl font-bold truncate">Band Setlist</h1>
          <p className="text-xs text-gray-400 truncate">{teamName}</p>
        </div>
        <ChevronDown size={14} className="text-gray-400 shrink-0 mt-3" />
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-2 w-56 bg-white border rounded-lg shadow-lg py-1 z-50">
          {teams.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => switchTeam(t.id)}
              disabled={switching}
              className="w-full flex items-center justify-between gap-2 px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
            >
              <span className="truncate">{t.name}</span>
              {t.id === activeTeamId && <Check size={14} className="text-gray-500 shrink-0" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
