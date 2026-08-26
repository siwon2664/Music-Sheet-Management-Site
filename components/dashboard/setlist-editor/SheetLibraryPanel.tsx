'use client';

import { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, GripVertical, Plus, Search } from 'lucide-react';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import { matchesSearch } from '@/lib/hangul';
import SheetPreviewModal from '@/components/sheets/SheetPreviewModal';

// 콘티 목록에 있던 곡을 여기로 끌어다 놓으면 삭제를 물어보는 드롭 영역 id.
// SetlistEditor의 onDragEnd/onDragOver가 이 id를 보고 "라이브러리 쪽으로 돌아왔는지"
// (라이브러리 카드면 무시) 또는 "콘티 곡을 여기로 가져왔는지"(삭제 확인)를 구분한다.
export const LIBRARY_DROP_ID = 'library-drop-zone';

export interface LibrarySheet {
  id: string;
  title: string;
  composer: string | null;
  key: string | null;
  bpm: number | null;
  tags: string[];
  file_url: string | null;
  updated_at: string;
}

interface SheetLibraryPanelProps {
  sheets: LibrarySheet[];
  teamId: string;
  addedSheetIds: Set<string>;
  onAdd: (sheet: LibrarySheet) => void;
  // 콘티 안의 곡을 이 패널 쪽으로 끌고 오는 중일 때 true — "놓으면 삭제됩니다" 안내를 보여준다.
  isDeleteTarget?: boolean;
  className?: string;
}

export default function SheetLibraryPanel({
  sheets,
  teamId,
  addedSheetIds,
  onAdd,
  isDeleteTarget = false,
  className,
}: SheetLibraryPanelProps) {
  const { setNodeRef: setLibraryDropRef } = useDroppable({ id: LIBRARY_DROP_ID });
  const [query, setQuery] = useState('');
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const sheet of sheets) {
      for (const tag of sheet.tags) set.add(tag);
    }
    return Array.from(set).sort();
  }, [sheets]);

  const filtered = useMemo(() => {
    return sheets.filter((sheet) => {
      if (activeTag && !sheet.tags.includes(activeTag)) return false;
      return matchesSearch(sheet.title, query);
    });
  }, [sheets, query, activeTag]);

  return (
    <section
      ref={setLibraryDropRef}
      data-drop-zone={LIBRARY_DROP_ID}
      className={[
        'relative bg-surface border rounded-lg p-4 md:p-6 flex flex-col gap-4 min-h-0 transition-colors',
        isDeleteTarget ? 'border-red-500 dark:border-red-400' : 'border-border',
        className ?? '',
      ].join(' ')}
    >
      {isDeleteTarget && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-red-500/10 dark:bg-red-500/15">
          <span className="text-sm font-medium text-red-600 dark:text-red-400 bg-surface border border-red-500 dark:border-red-400 rounded-full px-3 py-1.5 shadow-lg">
            여기에 놓으면 콘티에서 삭제됩니다
          </span>
        </div>
      )}
      <div>
        <button
          type="button"
          onClick={() => setCollapsed((prev) => !prev)}
          className="w-full flex items-center justify-between gap-2 mb-3"
        >
          <h2 className="text-lg font-semibold">악보 라이브러리</h2>
          {collapsed ? (
            <ChevronDown size={18} className="text-muted shrink-0" />
          ) : (
            <ChevronUp size={18} className="text-muted shrink-0" />
          )}
        </button>

        {!collapsed && (
          <>
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="제목 검색 (초성 검색 가능, 예: ㄴㅁㅅㅇㄷㄹ)"
                className="w-full bg-surface border border-border rounded pl-9 pr-3 py-2 text-sm"
              />
            </div>

            {allTags.length > 0 && (
              <div className="flex gap-2 overflow-x-auto mt-3 pb-1">
                <button
                  type="button"
                  onClick={() => setActiveTag(null)}
                  className={[
                    'shrink-0 rounded-full px-3 py-1 text-xs border',
                    activeTag === null ? 'bg-accent text-accent-foreground border-accent' : 'border-border hover:bg-surface-hover',
                  ].join(' ')}
                >
                  전체
                </button>
                {allTags.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => setActiveTag(tag === activeTag ? null : tag)}
                    className={[
                      'shrink-0 rounded-full px-3 py-1 text-xs border whitespace-nowrap',
                      activeTag === tag ? 'bg-accent text-accent-foreground border-accent' : 'border-border hover:bg-surface-hover',
                    ].join(' ')}
                  >
                    #{tag}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {!collapsed && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 overflow-y-auto max-h-[65vh] pr-1">
          {filtered.map((sheet, index) => (
            <DraggableSheetCard
              key={sheet.id}
              sheet={sheet}
              added={addedSheetIds.has(sheet.id)}
              onAdd={() => onAdd(sheet)}
              onPreview={() => setPreviewIndex(index)}
            />
          ))}

          {filtered.length === 0 && (
            <p className="text-sm text-muted col-span-full text-center py-8">검색 결과가 없습니다.</p>
          )}
        </div>
      )}

      {previewIndex !== null && (
        <SheetPreviewModal
          sheets={filtered}
          initialIndex={previewIndex}
          teamId={teamId}
          onClose={() => setPreviewIndex(null)}
        />
      )}
    </section>
  );
}

interface DraggableSheetCardProps {
  sheet: LibrarySheet;
  added: boolean;
  onAdd: () => void;
  onPreview: () => void;
}

// 콘티 목록으로 끌어다 놓을 수 있는 카드. dnd-kit(useDraggable)을 쓰기 때문에
// 마우스뿐 아니라 터치(모바일)에서도 왼쪽 손잡이를 잡고 그대로 콘티 목록 위로
// 드래그하면 추가된다. 손잡이만 드래그를 시작시키고 나머지 영역(제목 클릭 →
// 미리보기, 버튼 클릭 → 추가)은 그대로 두어 서로 간섭하지 않게 한다.
function DraggableSheetCard({ sheet, added, onAdd, onPreview }: DraggableSheetCardProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `library-${sheet.id}`,
    data: { type: 'library' as const, sheet },
    disabled: added,
  });

  return (
    <div
      ref={setNodeRef}
      className={[
        'border border-border rounded-lg p-3 flex flex-col gap-2 bg-surface-hover transition-opacity',
        isDragging ? 'opacity-40' : '',
      ].join(' ')}
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          {...attributes}
          {...listeners}
          disabled={added}
          aria-label={added ? '이미 추가된 악보입니다.' : '드래그해서 콘티에 추가'}
          title={added ? '이미 추가된 악보입니다.' : '드래그해서 콘티에 추가'}
          className={[
            'mt-0.5 shrink-0 touch-none rounded',
            added ? 'text-muted/40 cursor-not-allowed' : 'text-muted cursor-grab active:cursor-grabbing',
          ].join(' ')}
        >
          <GripVertical size={16} />
        </button>

        {/*
          손잡이 바깥에 <button>이나 드래그 리스너를 두면 브라우저가 드래그 시작과
          클릭을 혼동해 드래그가 간헐적으로 씹힌다. 그래서 클릭 가능한 div로 미리보기를 연다.
        */}
        <div
          role="button"
          tabIndex={0}
          onClick={onPreview}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') onPreview();
          }}
          className="flex-1 min-w-0 cursor-pointer"
        >
          <p className="font-medium leading-snug truncate hover:underline">{sheet.title}</p>
          <p className="text-xs text-muted mt-0.5 truncate">
            {[sheet.composer, sheet.key, sheet.bpm ? `${sheet.bpm} BPM` : null]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>

        <button
          type="button"
          onClick={onAdd}
          disabled={added}
          className="shrink-0 flex items-center gap-1 text-xs font-medium border border-border rounded px-2 py-1 hover:bg-surface disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Plus size={14} />
          {added ? '추가됨' : '콘티에 추가'}
        </button>
      </div>

      {sheet.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {sheet.tags.map((tag) => (
            <span key={tag} className="text-[10px] text-muted bg-surface rounded-full px-2 py-0.5">
              #{tag}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
