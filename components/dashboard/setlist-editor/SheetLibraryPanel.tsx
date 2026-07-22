'use client';

import { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Plus, Search } from 'lucide-react';
import { matchesSearch } from '@/lib/hangul';
import SheetPreviewModal from '@/components/sheets/SheetPreviewModal';

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
  className?: string;
}

export default function SheetLibraryPanel({
  sheets,
  teamId,
  addedSheetIds,
  onAdd,
  className,
}: SheetLibraryPanelProps) {
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
    <section className={`bg-white border rounded-lg p-4 md:p-6 flex flex-col gap-4 min-h-0 ${className ?? ''}`}>
      <div>
        <button
          type="button"
          onClick={() => setCollapsed((prev) => !prev)}
          className="w-full flex items-center justify-between gap-2 mb-3"
        >
          <h2 className="text-lg font-semibold">악보 라이브러리</h2>
          {collapsed ? (
            <ChevronDown size={18} className="text-gray-400 shrink-0" />
          ) : (
            <ChevronUp size={18} className="text-gray-400 shrink-0" />
          )}
        </button>

        {!collapsed && (
          <>
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="제목 검색 (초성 검색 가능, 예: ㄴㅁㅅㅇㄷㄹ)"
                className="w-full border rounded pl-9 pr-3 py-2 text-sm"
              />
            </div>

            {allTags.length > 0 && (
              <div className="flex gap-2 overflow-x-auto mt-3 pb-1">
                <button
                  type="button"
                  onClick={() => setActiveTag(null)}
                  className={[
                    'shrink-0 rounded-full px-3 py-1 text-xs border',
                    activeTag === null ? 'bg-black text-white border-black' : 'hover:bg-gray-50',
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
                      activeTag === tag ? 'bg-black text-white border-black' : 'hover:bg-gray-50',
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
          {filtered.map((sheet, index) => {
          const added = addedSheetIds.has(sheet.id);
          return (
            <div
              key={sheet.id}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData('application/sheet-id', sheet.id);
                e.dataTransfer.effectAllowed = 'copy';
              }}
              className="border rounded-lg p-3 flex flex-col gap-2 cursor-grab active:cursor-grabbing bg-gray-50"
            >
              <div className="flex items-start justify-between gap-2">
                {/*
                  드래그 가능한 카드 안에 <button>을 두면 브라우저가 드래그 시작과
                  클릭을 혼동해 드래그가 간헐적으로 씹힌다 (SetlistPanel에서 겪은 문제와 동일).
                  그래서 클릭 가능한 div로 미리보기를 연다.
                */}
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => setPreviewIndex(index)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') setPreviewIndex(index);
                  }}
                  className="min-w-0 cursor-pointer"
                >
                  <p className="font-medium leading-snug truncate hover:underline">{sheet.title}</p>
                  <p className="text-xs text-gray-500 mt-0.5 truncate">
                    {[sheet.composer, sheet.key, sheet.bpm ? `${sheet.bpm} BPM` : null]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onAdd(sheet)}
                  disabled={added}
                  className="shrink-0 flex items-center gap-1 text-xs font-medium border rounded px-2 py-1 hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Plus size={14} />
                  {added ? '추가됨' : '콘티에 추가'}
                </button>
              </div>

              {sheet.tags.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {sheet.tags.map((tag) => (
                    <span
                      key={tag}
                      className="text-[10px] text-gray-500 bg-gray-200 rounded-full px-2 py-0.5"
                    >
                      #{tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}

          {filtered.length === 0 && (
            <p className="text-sm text-gray-500 col-span-full text-center py-8">검색 결과가 없습니다.</p>
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
