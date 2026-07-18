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
  isCreator: boolean;
}

interface MembersManagerProps {
  currentUserId: string;
  initialMembers: MemberRow[];
}

export default function MembersManager({ currentUserId, initialMembers }: MembersManagerProps) {
  const router = useRouter();
  const supabase = createClient();

  const [members, setMembers] = useState(initialMembers);
  const [draftRoles, setDraftRoles] = useState<Record<string, TeamRole>>({});
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const leaderCount = useMemo(() => members.filter((m) => m.role === 'LEADER').length, [members]);

  const pendingChanges = members
    .map((member) => ({ member, nextRole: draftRoles[member.id] }))
    .filter(
      (change): change is { member: MemberRow; nextRole: TeamRole } =>
        !!change.nextRole && change.nextRole !== change.member.role
    );

  async function handleApplyAll() {
    if (pendingChanges.length === 0) return;

    setApplying(true);
    setError(null);

    const results = await Promise.all(
      pendingChanges.map(async ({ member, nextRole }) => {
        const { error: updateError } = await supabase
          .from('team_members')
          .update({ role: nextRole })
          .eq('id', member.id);
        return { memberId: member.id, nextRole, updateError };
      })
    );

    setApplying(false);

    const succeeded = results.filter((r) => !r.updateError);
    const failed = results.filter((r) => r.updateError);

    setMembers((prev) =>
      prev.map((m) => {
        const hit = succeeded.find((s) => s.memberId === m.id);
        return hit ? { ...m, role: hit.nextRole } : m;
      })
    );
    setDraftRoles((prev) => {
      const next = { ...prev };
      succeeded.forEach((s) => delete next[s.memberId]);
      return next;
    });

    if (failed.length > 0) {
      setError(`${failed.length}건 적용에 실패했습니다: ${failed[0].updateError?.message}`);
    }

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
          const locked = member.isCreator || isLastLeader;
          const busy = pendingId === member.id;
          const draftRole = draftRoles[member.id] ?? member.role;
          const hasPendingChange = draftRole !== member.role;

          return (
            <li
              key={member.id}
              className={`bg-white border rounded-lg px-4 py-3 flex items-center justify-between gap-3 ${
                hasPendingChange ? 'border-black' : ''
              }`}
            >
              <div className="min-w-0">
                <p className="font-medium truncate">
                  {member.displayName || member.email}
                  {isSelf && <span className="text-xs text-gray-400 ml-1">(나)</span>}
                  {hasPendingChange && (
                    <span className="text-xs text-gray-500 ml-1.5">(변경 예정: {draftRole})</span>
                  )}
                </p>
                <p className="text-xs text-gray-500 truncate">{member.email}</p>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <select
                  value={draftRole}
                  onChange={(e) =>
                    setDraftRoles((prev) => ({ ...prev, [member.id]: e.target.value as TeamRole }))
                  }
                  disabled={applying || busy || locked}
                  title={member.isCreator ? '이 팀을 만든 사람은 항상 팀장입니다.' : undefined}
                  className="border rounded px-2 py-1 text-xs disabled:opacity-50"
                >
                  <option value="LEADER">LEADER</option>
                  <option value="MEMBER">MEMBER</option>
                </select>

                <button
                  type="button"
                  onClick={() => handleRemove(member)}
                  disabled={applying || busy || locked}
                  className="text-gray-400 hover:text-red-600 disabled:opacity-30 disabled:cursor-not-allowed"
                  aria-label="팀에서 제거"
                  title={
                    member.isCreator
                      ? '이 팀을 만든 사람은 제거할 수 없습니다.'
                      : isLastLeader
                        ? '최소 한 명의 팀장이 필요합니다.'
                        : '팀에서 제거'
                  }
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      <button
        type="button"
        onClick={handleApplyAll}
        disabled={applying || pendingChanges.length === 0}
        className="self-end text-sm font-medium bg-black text-white rounded px-4 py-2 disabled:opacity-30 disabled:cursor-not-allowed"
      >
        {applying ? '적용 중...' : '변경사항 적용'}
      </button>
    </div>
  );
}
