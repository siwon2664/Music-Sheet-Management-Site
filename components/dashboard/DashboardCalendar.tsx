'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import CreateSetlistModal from '@/components/dashboard/CreateSetlistModal';
import SwipeToDeleteRow from '@/components/dashboard/SwipeToDeleteRow';
import { createClient } from '@/lib/supabase/client';
import type { TeamRole } from '@/types/supabase';

interface SetlistSummary {
  id: string;
  title: string;
  event_date: string; // YYYY-MM-DD
}

interface DashboardCalendarProps {
  teamId: string;
  role: TeamRole;
  year: number;
  month: number; // 1-12
  setlists: SetlistSummary[];
}

const WEEKDAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'];

function pad(n: number) {
  return String(n).padStart(2, '0');
}

function toDateKey(year: number, month: number, day: number) {
  return `${year}-${pad(month)}-${pad(day)}`;
}

function todayKey() {
  const now = new Date();
  return toDateKey(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

export default function DashboardCalendar({ teamId, role, year, month, setlists }: DashboardCalendarProps) {
  const router = useRouter();
  const supabase = createClient();
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [setlistsState, setSetlistsState] = useState(setlists);

  const setlistsByDate = useMemo(() => {
    const map = new Map<string, SetlistSummary[]>();
    for (const setlist of setlistsState) {
      const existing = map.get(setlist.event_date);
      if (existing) {
        existing.push(setlist);
      } else {
        map.set(setlist.event_date, [setlist]);
      }
    }
    return map;
  }, [setlistsState]);

  const cells = useMemo(() => {
    const daysInMonth = new Date(year, month, 0).getDate();
    const firstWeekday = new Date(year, month - 1, 1).getDay();
    const totalCells = Math.ceil((daysInMonth + firstWeekday) / 7) * 7;

    return Array.from({ length: totalCells }, (_, i) => {
      const dayNumber = i - firstWeekday + 1;
      if (dayNumber < 1 || dayNumber > daysInMonth) return null;
      return dayNumber;
    });
  }, [year, month]);

  const today = todayKey();

  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;

  function handleSelectDay(day: number) {
    setSelectedDate(toDateKey(year, month, day));
    setShowCreateModal(false);
  }

  async function handleDeleteSetlist(id: string) {
    if (!confirm('이 콘티를 삭제할까요?')) return;

    const { error } = await supabase.from('setlists').delete().eq('id', id);
    if (error) {
      alert(error.message);
      return;
    }

    setSetlistsState((prev) => prev.filter((setlist) => setlist.id !== id));
    router.refresh();
  }

  const selectedSetlists = selectedDate ? setlistsByDate.get(selectedDate) ?? [] : [];

  const selectedDateLabel = selectedDate
    ? new Date(`${selectedDate}T00:00:00`).toLocaleDateString('ko-KR', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        weekday: 'short',
      })
    : null;

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      <section className="md:col-span-2 bg-surface border border-border rounded-lg p-4 md:p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">
            {year}년 {month}월
          </h2>
          <div className="flex items-center gap-1">
            <Link
              href={`/dashboard?year=${prevYear}&month=${prevMonth}`}
              className="p-1.5 rounded hover:bg-surface-hover"
              aria-label="이전 달"
            >
              <ChevronLeft size={18} />
            </Link>
            <Link
              href={`/dashboard?year=${nextYear}&month=${nextMonth}`}
              className="p-1.5 rounded hover:bg-surface-hover"
              aria-label="다음 달"
            >
              <ChevronRight size={18} />
            </Link>
          </div>
        </div>

        {/* 헤더(요일)와 날짜 칸을 하나의 테두리 박스로 감싸고, 칸마다 위/왼쪽 선을
            그어서 전체적으로 이어진 표 형태의 옅은 구분선을 만든다. */}
        <div className="border border-border rounded-lg overflow-hidden">
          <div className="grid grid-cols-7 text-center text-xs text-muted">
            {WEEKDAY_LABELS.map((label, i) => (
              <div
                key={label}
                className={[
                  'py-2',
                  i > 0 ? 'border-l border-border' : '',
                  i === 0 ? 'text-red-500 dark:text-red-400' : i === 6 ? 'text-blue-500 dark:text-blue-400' : '',
                ].join(' ')}
              >
                {label}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 border-t border-border">
            {cells.map((day, i) => {
              const col = i % 7;
              const row = Math.floor(i / 7);
              const gridLineClasses = [col > 0 ? 'border-l border-border' : '', row > 0 ? 'border-t border-border' : ''].join(
                ' '
              );

              if (day === null) {
                return <div key={i} className={['aspect-square', gridLineClasses].join(' ')} />;
              }

              const dateKey = toDateKey(year, month, day);
              const hasSetlist = setlistsByDate.has(dateKey);
              const isSelected = selectedDate === dateKey;
              const isToday = dateKey === today;

              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => handleSelectDay(day)}
                  className={[
                    'relative aspect-square flex flex-col items-center justify-center text-sm',
                    gridLineClasses,
                    isSelected ? 'bg-accent text-accent-foreground' : 'hover:bg-surface-hover',
                    isToday && !isSelected ? 'font-semibold text-blue-600 dark:text-blue-400' : '',
                  ].join(' ')}
                >
                  {isToday && (
                    <span
                      className={[
                        'absolute top-1 left-1 w-1.5 h-1.5 rounded-full',
                        isSelected ? 'bg-accent-foreground' : 'bg-blue-600 dark:bg-blue-400',
                      ].join(' ')}
                    />
                  )}
                  {day}
                  {hasSetlist && (
                    <span
                      className={[
                        'absolute bottom-1 w-1.5 h-1.5 rounded-full',
                        isSelected ? 'bg-accent-foreground' : 'bg-foreground',
                      ].join(' ')}
                    />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </section>

      <section className="bg-surface border border-border rounded-lg p-4 md:p-6 flex flex-col gap-4">
        {!selectedDate ? (
          <p className="text-sm text-muted">달력에서 날짜를 선택해주세요.</p>
        ) : (
          <>
            <h3 className="text-sm font-medium text-muted">{selectedDateLabel}</h3>

            {selectedSetlists.length > 0 && (
              <ul className="flex flex-col gap-2">
                {selectedSetlists.map((setlist) => {
                  const card = (
                    <button
                      type="button"
                      onClick={() => router.push(`/dashboard/setlist/${setlist.id}`)}
                      className="w-full text-left border border-border rounded px-4 py-3 hover:bg-surface-hover"
                    >
                      <p className="font-semibold">{setlist.title}</p>
                      <p className="text-xs text-muted mt-1">자세히 보기 →</p>
                    </button>
                  );

                  return (
                    <li key={setlist.id}>
                      {role === 'LEADER' ? (
                        <SwipeToDeleteRow onDelete={() => handleDeleteSetlist(setlist.id)}>
                          {card}
                        </SwipeToDeleteRow>
                      ) : (
                        card
                      )}
                    </li>
                  );
                })}
              </ul>
            )}

            {role === 'LEADER' ? (
              <button
                type="button"
                onClick={() => setShowCreateModal(true)}
                className="flex items-center justify-center gap-2 border border-dashed border-border rounded px-4 py-3 text-sm font-medium hover:bg-surface-hover"
              >
                <Plus size={16} />이 날짜에 새 콘티 만들기
              </button>
            ) : (
              selectedSetlists.length === 0 && (
                <p className="text-sm text-muted">이 날짜에 예정된 콘티가 없습니다.</p>
              )
            )}
          </>
        )}
      </section>

      {showCreateModal && selectedDate && (
        <CreateSetlistModal
          teamId={teamId}
          date={selectedDate}
          onClose={() => setShowCreateModal(false)}
        />
      )}
    </div>
  );
}
