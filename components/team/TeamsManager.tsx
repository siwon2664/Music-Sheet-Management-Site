'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, LogOut, Trash2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import type { UserTeam } from '@/lib/activeTeam';

interface TeamsManagerProps {
  teams: UserTeam[];
  activeTeamId: string | null;
}

export default function TeamsManager({ teams: initialTeams, activeTeamId }: TeamsManagerProps) {
  const router = useRouter();
  const supabase = createClient();

  const [teams, setTeams] = useState(initialTeams);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function switchTo(teamId: string) {
    if (teamId === activeTeamId || busyId) return;
    setBusyId(teamId);
    await fetch('/api/teams/active', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ teamId }),
    });
    setBusyId(null);
    router.push('/dashboard');
    router.refresh();
  }

  async function handleLeave(team: UserTeam) {
    if (busyId) return;
    if (!confirm(`"${team.name}" 팀에서 탈퇴할까요?`)) return;

    setBusyId(team.id);
    setError(null);
    const { error: rpcError } = await supabase.rpc('leave_team', { p_team_id: team.id });
    setBusyId(null);

    if (rpcError) {
      setError(rpcError.message);
      return;
    }

    setTeams((prev) => prev.filter((t) => t.id !== team.id));
    if (team.id === activeTeamId) router.push('/dashboard');
    router.refresh();
  }

  async function handleDelete(team: UserTeam) {
    if (busyId) return;
    const typed = prompt(
      `정말 "${team.name}" 팀을 삭제할까요? 되돌릴 수 없고, 팀의 모든 악보·콘티·필기·멤버 정보가 함께 삭제됩니다.\n\n확인하려면 팀 이름을 정확히 입력하세요.`
    );
    if (typed === null) return;
    if (typed !== team.name) {
      alert('입력한 이름이 팀 이름과 일치하지 않아 취소되었습니다.');
      return;
    }

    setBusyId(team.id);
    setError(null);
    const { error: rpcError } = await supabase.rpc('delete_team', { p_team_id: team.id });
    setBusyId(null);

    if (rpcError) {
      setError(rpcError.message);
      return;
    }

    setTeams((prev) => prev.filter((t) => t.id !== team.id));
    if (team.id === activeTeamId) router.push('/dashboard');
    router.refresh();
  }

  if (teams.length === 0) {
    return <p className="text-sm text-gray-500">속한 팀이 없습니다.</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      {error && <p className="text-sm text-red-600">{error}</p>}

      {teams.map((team) => (
        <div
          key={team.id}
          className="border rounded-lg px-4 py-3 flex items-center justify-between gap-3"
        >
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="font-medium truncate">{team.name}</span>
              {team.id === activeTeamId && <Check size={14} className="text-green-600 shrink-0" />}
            </div>
            <p className="text-xs text-gray-500">
              {team.role === 'LEADER' ? '팀장' : '멤버'}
              {team.isCreator ? ' · 개설자' : ''}
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {team.id !== activeTeamId && (
              <button
                type="button"
                onClick={() => switchTo(team.id)}
                disabled={busyId === team.id}
                className="text-xs border rounded px-2.5 py-1.5 hover:bg-gray-50 disabled:opacity-50"
              >
                전환
              </button>
            )}
            {team.role === 'LEADER' && (
              <button
                type="button"
                onClick={() => handleDelete(team)}
                disabled={busyId === team.id}
                className="flex items-center gap-1 text-xs border border-red-200 text-red-600 rounded px-2.5 py-1.5 hover:bg-red-50 disabled:opacity-50"
              >
                <Trash2 size={12} />
                삭제
              </button>
            )}
            {!team.isCreator && (
              <button
                type="button"
                onClick={() => handleLeave(team)}
                disabled={busyId === team.id}
                className="flex items-center gap-1 text-xs border rounded px-2.5 py-1.5 hover:bg-gray-50 disabled:opacity-50"
              >
                <LogOut size={12} />
                탈퇴
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
