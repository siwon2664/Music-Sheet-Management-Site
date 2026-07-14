'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import type { TeamRole } from '@/types/supabase';

export interface MemberRow {
  id: string; // team_members row id
  userId: string;
  email: string;
  displayName: string | null;
  role: TeamRole;
}

interface MembersManagerProps {
  currentUserId: string;
  initialMembers: MemberRow[];
}

export default function MembersManager({ currentUserId, initialMembers }: MembersManagerProps) {
  const router = useRouter();
  const supabase = createClient();

  const [members, setMembers] = useState(initialMembers);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const leaderCount = useMemo(() => members.filter((m) => m.role === 'LEADER').length, [members]);

  async function handleRoleChange(member: MemberRow, nextRole: TeamRole) {
    setPendingId(member.id);
    setError(null);

    const { error: updateError } = await supabase
      .from('team_members')
      .update({ role: nextRole })
      .eq('id', member.id);

    setPendingId(null);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    setMembers((prev) => prev.map((m) => (m.id === member.id ? { ...m, role: nextRole } : m)));
    router.refresh();
  }

  async function handleRemove(member: MemberRow) {
    if (!confirm(`${member.displayName || member.email}님을 팀에서 제거할까요?`)) return;

    setPendingId(member.id);
    setError(null);

    const { error: deleteError } = await supabase.from('team_members').delete().eq('id', member.id);

    setPendingId(null);

    if (deleteError) {
      setError(deleteError.message);
      return;
    }

    setMembers((prev) => prev.filter((m) => m.id !== member.id));
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3">
      {error && <p className="text-sm text-red-600">{error}</p>}

      <ul className="flex flex-col gap-2">
        {members.map((member) => {
          const isSelf = member.userId === currentUserId;
          const isLastLeader = member.role === 'LEADER' && leaderCount <= 1;
          const busy = pendingId === member.id;

          return (
            <li
              key={member.id}
              className="bg-white border rounded-lg px-4 py-3 flex items-center justify-between gap-3"
            >
              <div className="min-w-0">
                <p className="font-medium truncate">
                  {member.displayName || member.email}
                  {isSelf && <span className="text-xs text-gray-400 ml-1">(나)</span>}
                </p>
                <p className="text-xs text-gray-500 truncate">{member.email}</p>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <select
                  value={member.role}
                  onChange={(e) => handleRoleChange(member, e.target.value as TeamRole)}
                  disabled={busy || isLastLeader}
                  className="border rounded px-2 py-1 text-xs disabled:opacity-50"
                >
                  <option value="LEADER">LEADER</option>
                  <option value="MEMBER">MEMBER</option>
                </select>

                <button
                  type="button"
                  onClick={() => handleRemove(member)}
                  disabled={busy || isLastLeader}
                  className="text-gray-400 hover:text-red-600 disabled:opacity-30 disabled:cursor-not-allowed"
                  aria-label="팀에서 제거"
                  title={isLastLeader ? '최소 한 명의 팀장이 필요합니다.' : '팀에서 제거'}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
