'use client';

import { useMemo, useState, type DragEvent } from 'react';
import { GripVertical, Trash2 } from 'lucide-react';
import SheetPreviewModal from '@/components/sheets/SheetPreviewModal';

const KEY_OPTIONS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export interface SetlistItem {
  id: string;
  sheetId: string;
  title: string;
  originalKey: string | null;
  transposedKey: string | null;
  note: string;
  fileUrl: string | null;
}

interface SetlistPanelProps {
  items: SetlistItem[];
  teamId: string;
  onRemove: (index: number) => void;
  onUpdate: (index: number, patch: Partial<SetlistItem>) => void;
  onMove: (fromIndex: number, toIndex: number) => void;
  onDropSheet: (sheetId: string, index: number) => void;
}

export default function SetlistPanel({
  items,
  teamId,
  onRemove,
  onUpdate,
  onMove,
  onDropSheet,
}: SetlistPanelProps) {
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
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

  function handleDrop(e: DragEvent<HTMLDivElement>, index: number) {
    e.preventDefault();
    e.stopPropagation();
    setDragOverIndex(null);

    const sheetId = e.dataTransfer.getData('application/sheet-id');
    const itemIndexStr = e.dataTransfer.getData('application/item-index');

    if (sheetId) {
      onDropSheet(sheetId, index);
    } else if (itemIndexStr) {
      onMove(Number(itemIndexStr), index);
    }
  }

  return (
    <section className="bg-white border rounded-lg p-4 md:p-6 flex flex-col gap-3 min-h-0">
      <h2 className="text-lg font-semibold">현재 콘티 목록</h2>

      <div
        className="flex flex-col gap-2 flex-1 min-h-[140px]"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => handleDrop(e, items.length)}
      >
        {items.map((item, index) => (
          <div key={item.id}>
            {dragOverIndex === index && <div className="h-1 rounded bg-black/70 mb-1" />}
            <div
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData('application/item-index', String(index));
                e.dataTransfer.effectAllowed = 'move';
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOverIndex(index);
              }}
              onDragLeave={() => setDragOverIndex((cur) => (cur === index ? null : cur))}
              onDragEnd={() => setDragOverIndex(null)}
              onDrop={(e) => handleDrop(e, index)}
              className="border rounded-lg p-3 flex flex-col gap-2 bg-gray-50 cursor-grab active:cursor-grabbing"
            >
              <div className="flex items-start gap-2">
                <GripVertical size={16} className="text-gray-400 mt-1 shrink-0" />
                <span className="text-sm font-semibold text-gray-400 w-5 shrink-0">{index + 1}</span>
                {/*
                  드래그 가능한 카드 안에 <button>처럼 네이티브로 포커스 가능한
                  요소가 있으면, 브라우저가 드래그 시작과 클릭 제스처를 혼동해
                  드래그가 간헐적으로 씹힌다. 그래서 클릭 가능한 div로 대체한다.
                */}
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => setPreviewIndex(index)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') setPreviewIndex(index);
                  }}
                  className="flex-1 min-w-0 text-left cursor-pointer"
                >
                  <p className="font-medium truncate hover:underline">{item.title}</p>
                </div>
                <button
                  type="button"
                  onClick={() => onRemove(index)}
                  className="shrink-0 text-gray-400 hover:text-red-600"
                  aria-label="삭제"
                >
                  <Trash2 size={16} />
                </button>
              </div>

              <div className="flex items-center gap-2 pl-7">
                <label className="text-xs text-gray-500 flex items-center gap-1">
                  Key
                  <select
                    value={item.transposedKey ?? ''}
                    onChange={(e) => onUpdate(index, { transposedKey: e.target.value || null })}
                    className="border rounded px-2 py-1 text-xs"
                  >
                    <option value="">{item.originalKey ? `원본 (${item.originalKey})` : '원본'}</option>
                    {KEY_OPTIONS.map((key) => (
                      <option key={key} value={key}>
                        {key}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <input
                type="text"
                value={item.note}
                onChange={(e) => onUpdate(index, { note: e.target.value })}
                placeholder="송폼 메모 (예: 전주 없이 바로 싱어 카피로 진입)"
                className="border rounded px-2 py-1.5 text-xs ml-7"
              />
            </div>
          </div>
        ))}

        {items.length === 0 && (
          <div className="flex-1 flex items-center justify-center border border-dashed rounded-lg text-sm text-gray-400 py-10">
            왼쪽에서 곡을 추가하거나 드래그해서 놓아주세요.
          </div>
        )}
      </div>

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
