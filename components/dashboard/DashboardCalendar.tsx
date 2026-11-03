'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import CreateSetlistModal from '@/components/dashboard/CreateSetlistModal';
import SwipeToDeleteRow from '@/components/dashboard/SwipeToDeleteRow';
import { todayKeyInKorea } from '@/lib/koreaTime';
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
const SELECTED_DATE_KEY = 'dashboard-selected-date';

function pad(n: number) {
  return String(n).padStart(2, '0');
}

function toDateKey(year: number, month: number, day: number) {
  return `${year}-${pad(month)}-${pad(day)}`;
}

export default function DashboardCalendar({ teamId, role, year, month, setlists }: DashboardCalendarProps) {
  const router = useRouter();
  const supabase = createClient();
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [setlistsState, setSetlistsState] = useState(setlists);

  // 콘티를 보고 돌아와도 고르던 날짜가 그대로 남게 한다. 서버 렌더링과 어긋나지 않도록 마운트 후에 읽는다.
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(SELECTED_DATE_KEY);
      if (saved?.startsWith(`${year}-${pad(month)}-`)) setSelectedDate(saved);
    } catch {
      // 저장소를 못 쓰는 환경이면 선택을 복원하지 않는다.
    }
  }, [year, month]);

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

  const today = todayKeyInKorea();

  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;

  function handleSelectDay(day: number) {
    const dateKey = toDateKey(year, month, day);
    setSelectedDate(dateKey);
    setShowCreateModal(false);
    try {
      sessionStorage.setItem(SELECTED_DATE_KEY, dateKey);
    } catch {
      // 위와 같음
    }
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
              const daySetlists = setlistsByDate.get(dateKey) ?? [];
              const hasSetlist = daySetlists.length > 0;
              const isSelected = selectedDate === dateKey;
              const isToday = dateKey === today;

              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => handleSelectDay(day)}
                  className={[
                    'relative aspect-square min-w-0 flex flex-col items-center justify-center gap-0.5 text-sm',
                    gridLineClasses,
                    // 테마마다 accent 색이 달라 글자가 안 보일 수 있으므로 항상 대비가 보장되는 조합을 쓴다.
                    isSelected ? 'bg-foreground text-background' : 'hover:bg-surface-hover',
                  ].join(' ')}
                >
                  <span
                    aria-current={isToday ? 'date' : undefined}
                    className={[
                      'w-7 h-7 flex items-center justify-center rounded-full',
                      isToday ? 'font-semibold ring-2 ring-blue-600 dark:ring-blue-400' : '',
                    ].join(' ')}
                  >
                    {day}
                  </span>
                  {hasSetlist && (
                    <>
                      <span className="hidden md:block w-full px-1 truncate text-[10px] leading-tight">
                        {daySetlists[0].title}
                        {daySetlists.length > 1 && ` +${daySetlists.length - 1}`}
                      </span>
                      <span
                        className={[
                          'md:hidden absolute bottom-1 w-1.5 h-1.5 rounded-full',
                          isSelected ? 'bg-background' : 'bg-foreground',
                        ].join(' ')}
                      />
                    </>
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
