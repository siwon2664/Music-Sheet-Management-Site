'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Pin, Plus } from 'lucide-react';
import CreateFixedSetlistModal from './CreateFixedSetlistModal';
import type { TeamRole } from '@/types/supabase';

interface FixedSetlist {
  id: string;
  title: string;
}

interface FixedSetlistsProps {
  setlists: FixedSetlist[];
  teamId: string;
  role: TeamRole;
}

export default function FixedSetlists({ setlists, teamId, role }: FixedSetlistsProps) {
  const [showCreateModal, setShowCreateModal] = useState(false);

  if (setlists.length === 0 && role !== 'LEADER') return null;

  return (
    <section className="mb-6 bg-white border rounded-lg p-4 md:p-6">
      <div className="flex items-center justify-between gap-3 mb-3">
        <h2 className="text-sm font-semibold text-gray-500">고정 콘티</h2>
        {role === 'LEADER' && (
          <button
            type="button"
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-1 text-xs font-medium border rounded-full px-3 py-1.5 hover:bg-gray-50"
          >
            <Plus size={12} />
            고정 콘티 추가
          </button>
        )}
      </div>

      {setlists.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {setlists.map((setlist) => (
            <Link
              key={setlist.id}
              href={`/dashboard/setlist/${setlist.id}`}
              className="flex items-center gap-2 border rounded-full px-4 py-2 text-sm font-medium hover:bg-gray-50"
            >
              <Pin size={14} />
              {setlist.title}
            </Link>
          ))}
        </div>
      )}

      {showCreateModal && (
        <CreateFixedSetlistModal teamId={teamId} onClose={() => setShowCreateModal(false)} />
      )}
    </section>
  );
}
