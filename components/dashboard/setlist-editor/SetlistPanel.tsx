'use client';

import { Fragment, useMemo, useState } from 'react';
import { GripVertical, Trash2 } from 'lucide-react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import SheetPreviewModal from '@/components/sheets/SheetPreviewModal';
import SongFormEditor from './SongFormEditor';
import type { LibrarySheet } from './SheetLibraryPanel';
import type { TeamRole } from '@/types/supabase';

const KEY_OPTIONS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// 라이브러리에서 곡을 끌어와 목록 맨 끝(또는 빈 목록)에 놓을 때 쓰는 드롭 영역 id.
// DndContext는 이제 SetlistEditor가 갖고 있어서, 그쪽의 onDragEnd에서도 같은 id를
// 참조해 몇 번째 자리에 끼워 넣을지 계산한다.
export const SETLIST_DROP_END_ID = 'setlist-drop-end';

export interface SetlistItem {
  id: string;
  sheetId: string;
  title: string;
  originalKey: string | null;
  transposedKey: string | null;
  note: string;
  fileUrl: string | null;
  songForm: string[];
  bpm: number | null;
  // 악보 파일의 sheets.updated_at — 오프라인 캐시 버전 구분에 쓰인다.
  updatedAt: string;
}

interface SetlistPanelProps {
  items: SetlistItem[];
  teamId: string;
  role: TeamRole;
  // 라이브러리에서 곡을 드래그해오는 중일 때, 몇 번째 자리에 놓일지(0-based).
  // 목록 끝(또는 빈 목록)에 놓일 때는 items.length와 같다. 콘티 내부 순서 변경
  // 드래그 중에는 null — 그건 dnd-kit의 useSortable 애니메이션으로 충분히 보여준다.
  dragOverIndex: number | null;
  // dragOverIndex가 가리키는 자리에 반투명 미리보기로 끼워 넣을, 지금 끌고 있는 악보.
  draggingSheet: LibrarySheet | null;
  onRemove: (index: number) => void;
  onUpdate: (index: number, patch: Partial<SetlistItem>) => void;
  onUpdateBpm: (sheetId: string, bpm: number | null) => void;
  className?: string;
}

export default function SetlistPanel({
  items,
  teamId,
  role,
  dragOverIndex,
  draggingSheet,
  onRemove,
  onUpdate,
  onUpdateBpm,
  className,
}: SetlistPanelProps) {
  const canReorder = role === 'LEADER';
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);

  const previewSheets = useMemo(
    () =>
      items.map((item) => ({
        id: item.id,
        sheetId: item.sheetId,
        title: item.title,
        key: item.transposedKey ?? item.originalKey,
        file_url: item.fileUrl,
      })),
    [items]
  );

  const { setNodeRef: setEndDropRef } = useDroppable({ id: SETLIST_DROP_END_ID });

  return (
    <section className={`bg-surface border border-border rounded-lg p-4 md:p-6 flex flex-col gap-3 min-h-0 ${className ?? ''}`}>
      <h2 className="text-lg font-semibold">현재 콘티 목록</h2>

      <SortableContext items={items.map((item) => item.id)} strategy={verticalListSortingStrategy}>
        <div ref={setEndDropRef} className="flex flex-col flex-1 min-h-[140px]">
          {/*
            곡 사이사이(맨 앞·맨 뒤 포함, N개면 N+1군데)에 항상 "틈"을 하나씩 깔아두고,
            지금 드래그가 가리키는 자리의 틈만 높이를 펼쳐서 그 안에 끌고 있는 악보를
            반투명 카드로 보여준다. 틈이 열리고 닫히는 높이 자체를 트랜지션으로 걸어두면,
            그 아래에 있던 곡 카드들은 매 프레임 새로 계산된 위치로 자연스럽게 밀려난다.
          */}
          <SetlistGap visible={dragOverIndex === 0} sheet={draggingSheet} />

          {items.map((item, index) => (
            <Fragment key={item.id}>
              <SortableSetlistRow
                item={item}
                index={index}
                canReorder={canReorder}
                onPreview={() => setPreviewIndex(index)}
                onRemove={() => onRemove(index)}
                onUpdate={(patch) => onUpdate(index, patch)}
                onUpdateBpm={onUpdateBpm}
              />
              <SetlistGap visible={dragOverIndex === index + 1} sheet={draggingSheet} />
            </Fragment>
          ))}

          {items.length === 0 && (
            <div className="flex-1 flex items-center justify-center border border-dashed border-border rounded-lg text-sm text-muted py-10">
              곡을 추가하거나 라이브러리에서 드래그해서 놓아주세요.
            </div>
          )}
        </div>
      </SortableContext>

      {previewIndex !== null && (
        <SheetPreviewModal
          sheets={previewSheets}
          initialIndex={previewIndex}
          teamId={teamId}
          onClose={() => setPreviewIndex(null)}
        />
      )}
    </section>
  );
}

interface SetlistGapProps {
  visible: boolean;
  sheet: LibrarySheet | null;
}

// 라이브러리에서 끌어온 곡이 놓일 자리를 보여주는, 펼쳐지고 접히는 틈.
// grid-template-rows를 0fr↔1fr로 트랜지션하는 방식이라 실제 높이를 몰라도
// 부드럽게 늘어나고 줄어든다.
function SetlistGap({ visible, sheet }: SetlistGapProps) {
  const open = visible && !!sheet;

  return (
    <div
      className="grid transition-[grid-template-rows,margin-bottom] duration-200 ease-out"
      style={{ gridTemplateRows: open ? '1fr' : '0fr', marginBottom: open ? '0.5rem' : '0px' }}
    >
      <div className="overflow-hidden">
        {sheet && (
          <div className="border-2 border-dashed border-accent rounded-lg p-3 bg-accent-subtle/70">
            <p className="font-medium leading-snug truncate text-accent-subtle-foreground">{sheet.title}</p>
            <p className="text-xs text-muted mt-0.5 truncate">
              {[sheet.composer, sheet.key, sheet.bpm ? `${sheet.bpm} BPM` : null].filter(Boolean).join(' · ')}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

interface SortableSetlistRowProps {
  item: SetlistItem;
  index: number;
  canReorder: boolean;
  onPreview: () => void;
  onRemove: () => void;
  onUpdate: (patch: Partial<SetlistItem>) => void;
  onUpdateBpm: (sheetId: string, bpm: number | null) => void;
}

function SortableSetlistRow({
  item,
  index,
  canReorder,
  onPreview,
  onRemove,
  onUpdate,
  onUpdateBpm,
}: SortableSetlistRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
    disabled: !canReorder,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div ref={setNodeRef} style={style} className={`mb-2 ${isDragging ? 'relative z-10' : 'relative'}`}>
      <div
        className={`border border-border rounded-lg p-3 flex flex-col gap-2 bg-surface-hover transition-shadow ${
          isDragging ? 'opacity-60 shadow-lg' : ''
        }`}
      >
        <div className="flex items-start gap-2">
          <button
            type="button"
            {...attributes}
            {...listeners}
            disabled={!canReorder}
            title={canReorder ? '드래그해서 순서 변경' : '팀장만 순서를 변경할 수 있습니다.'}
            aria-label={canReorder ? '드래그해서 순서 변경' : '팀장만 순서를 변경할 수 있습니다.'}
            className={`mt-1 shrink-0 touch-none rounded ${
              canReorder ? 'cursor-grab text-muted active:cursor-grabbing' : 'cursor-not-allowed text-muted/50'
            }`}
          >
            <GripVertical size={16} />
          </button>
          <span className="text-sm font-semibold text-muted w-5 shrink-0">{index + 1}</span>
          {/*
            드래그 가능한 카드 안에 <button>처럼 네이티브로 포커스 가능한
            요소가 있으면, 브라우저가 드래그 시작과 클릭 제스처를 혼동해
            드래그가 간헐적으로 씹힌다. 그래서 클릭 가능한 div로 대체한다.
          */}
          <div
            role="button"
            tabIndex={0}
            onClick={onPreview}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') onPreview();
            }}
            className="flex-1 min-w-0 text-left cursor-pointer"
          >
            <p className="font-medium truncate hover:underline">{item.title}</p>
          </div>
          <button
            type="button"
            onClick={() => {
              if (confirm(`"${item.title}"을(를) 콘티에서 삭제할까요?`)) {
                onRemove();
              }
            }}
            className="shrink-0 text-muted hover:text-red-600 dark:hover:text-red-400"
            aria-label="삭제"
          >
            <Trash2 size={16} />
          </button>
        </div>

        <div className="flex items-center gap-2 pl-7">
          <label className="text-xs text-muted flex items-center gap-1">
            Key
            <select
              value={item.transposedKey ?? ''}
              onChange={(e) => onUpdate({ transposedKey: e.target.value || null })}
              className="border border-border bg-surface rounded px-2 py-1 text-xs"
            >
              <option value="">{item.originalKey ? `원본 (${item.originalKey})` : '원본'}</option>
              {KEY_OPTIONS.map((key) => (
                <option key={key} value={key}>
                  {key}
                </option>
              ))}
            </select>
          </label>

          <label className="text-xs text-muted flex items-center gap-1">
            BPM
            <input
              type="number"
              min={0}
              value={item.bpm ?? ''}
              onChange={(e) => onUpdate({ bpm: e.target.value ? Number(e.target.value) : null })}
              onBlur={(e) => onUpdateBpm(item.sheetId, e.target.value ? Number(e.target.value) : null)}
              placeholder="-"
              className="w-14 border border-border bg-surface rounded px-2 py-1 text-xs"
            />
          </label>
        </div>

        <input
          type="text"
          value={item.note}
          onChange={(e) => onUpdate({ note: e.target.value })}
          placeholder="송폼 메모 (예: 전주 없이 바로 싱어 카피로 진입)"
          className="border border-border bg-surface rounded px-2 py-1.5 text-xs ml-7"
        />

        <SongFormEditor value={item.songForm} onChange={(next) => onUpdate({ songForm: next })} />
      </div>
    </div>
  );
}
