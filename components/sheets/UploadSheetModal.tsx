'use client';

import { useState, type DragEvent as ReactDragEvent, type FormEvent } from 'react';
import { UploadCloud, X } from 'lucide-react';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { createClient } from '@/lib/supabase/client';
import { uploadSheetFile } from '@/lib/sheetUpload';
import { isAllowedSheetFile, SHEET_FILE_ACCEPT, SHEET_FILE_TYPE_HINT } from '@/lib/fileTypes';
import { MAX_SHEETS_PER_TEAM, SHEET_LIMIT_MESSAGE } from '@/lib/limits';
import { composePagesIntoFile, expandFileToPages, revokePagePreview, type PendingPage } from '@/lib/pageCompose';
import type { SheetRow } from './SheetsLibraryClient';

interface UploadSheetModalProps {
  teamId: string;
  currentCount: number;
  limitExempt?: boolean;
  onClose: () => void;
  onUploaded: (sheet: SheetRow) => void;
}

export default function UploadSheetModal({
  teamId,
  currentCount,
  limitExempt = false,
  onClose,
  onUploaded,
}: UploadSheetModalProps) {
  const supabase = createClient();
  const atLimit = !limitExempt && currentCount >= MAX_SHEETS_PER_TEAM;

  const [title, setTitle] = useState('');
  const [composer, setComposer] = useState('');
  const [key, setKey] = useState('');
  const [bpm, setBpm] = useState('');
  // PDF는 페이지 수만큼, 이미지는 파일마다 1장씩 펼쳐서 담아둔다. 여러 장이
  // 섞여 있어도 업로드 시점엔 하나로 합쳐 sheets 레코드 1개로 등록한다.
  const [pages, setPages] = useState<PendingPage[]>([]);
  const [expanding, setExpanding] = useState(false);
  const [dropActive, setDropActive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  async function addFiles(files: File[]) {
    const valid = files.filter((f) => isAllowedSheetFile(f));
    if (valid.length < files.length) setError(SHEET_FILE_TYPE_HINT);
    else setError(null);
    if (valid.length === 0) return;

    setExpanding(true);
    try {
      const expanded = await Promise.all(valid.map(expandFileToPages));
      setPages((prev) => [...prev, ...expanded.flat()]);
    } catch {
      setError('파일을 불러오지 못했습니다.');
    } finally {
      setExpanding(false);
    }
  }

  function removePage(id: string) {
    setPages((prev) => {
      const target = prev.find((p) => p.id === id);
      if (target) revokePagePreview(target);
      return prev.filter((p) => p.id !== id);
    });
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setPages((prev) => {
      const oldIndex = prev.findIndex((p) => p.id === active.id);
      const newIndex = prev.findIndex((p) => p.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return prev;
      return arrayMove(prev, oldIndex, newIndex);
    });
  }

  function handleDropZoneDrop(e: ReactDragEvent<HTMLLabelElement>) {
    e.preventDefault();
    setDropActive(false);
    const dropped = Array.from(e.dataTransfer.files ?? []);
    if (dropped.length > 0) addFiles(dropped);
  }

  async function handleUpload(e: FormEvent) {
    e.preventDefault();

    if (atLimit) {
      setError(SHEET_LIMIT_MESSAGE);
      return;
    }

    if (pages.length === 0) {
      setError('파일을 선택해주세요.');
      return;
    }

    setLoading(true);
    setError(null);

    let composedFile: File;
    try {
      composedFile = await composePagesIntoFile(pages);
    } catch {
      setLoading(false);
      setError('페이지를 합치지 못했습니다.');
      return;
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setLoading(false);
      setError('로그인이 필요합니다.');
      return;
    }

    const { data: uploadedFile, error: uploadError } = await uploadSheetFile(supabase, teamId, composedFile);

    if (uploadError || !uploadedFile) {
      setLoading(false);
      setError(uploadError ?? '파일을 업로드하지 못했습니다.');
      return;
    }

    const { data: sheet, error: insertError } = await supabase
      .from('sheets')
      .insert({
        team_id: teamId,
        title,
        composer: composer || null,
        key: key || null,
        bpm: bpm ? Number(bpm) : null,
        file_url: uploadedFile.filePath,
        thumbnail_url: uploadedFile.thumbnailPath,
        created_by: user.id,
      })
      .select('id, title, composer, key, bpm, tags, file_url, thumbnail_url, created_at')
      .single();

    setLoading(false);

    if (insertError) {
      setError(insertError.message);
      return;
    }

    onUploaded(sheet);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-surface text-foreground rounded-lg shadow-lg w-full max-w-sm p-6 relative">
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 text-muted hover:text-foreground"
          aria-label="닫기"
        >
          <X size={18} />
        </button>

        <h2 className="text-lg font-semibold mb-4">새 악보 추가</h2>

        <form onSubmit={handleUpload} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm">
            제목
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="border border-border bg-surface rounded px-3 py-2"
              autoFocus
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            작곡가 (선택)
            <input
              type="text"
              value={composer}
              onChange={(e) => setComposer(e.target.value)}
              className="border border-border bg-surface rounded px-3 py-2"
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-sm">
              Key (선택)
              <input
                type="text"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="예: G"
                className="border border-border bg-surface rounded px-3 py-2"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              BPM (선택)
              <input
                type="number"
                min={0}
                value={bpm}
                onChange={(e) => setBpm(e.target.value)}
                className="border border-border bg-surface rounded px-3 py-2"
              />
            </label>
          </div>

          <div className="flex flex-col gap-1 text-sm">
            파일 (PDF, PNG, JPG, WEBP — 여러 장 가능)
            <label
              onDragOver={(e) => {
                e.preventDefault();
                setDropActive(true);
              }}
              onDragLeave={() => setDropActive(false)}
              onDrop={handleDropZoneDrop}
              className={`border border-dashed border-border rounded px-3 py-4 flex flex-col items-center gap-2 text-muted cursor-pointer ${
                dropActive ? 'border-accent bg-surface-hover' : ''
              }`}
            >
              <UploadCloud size={20} />
              <span className="text-xs text-center">
                끌어다 놓거나 클릭해서 선택하세요
                <br />
                (PDF 여러 페이지 또는 이미지 여러 장 모두 가능)
              </span>
              <input
                type="file"
                multiple
                accept={SHEET_FILE_ACCEPT}
                onChange={(e) => {
                  const selected = Array.from(e.target.files ?? []);
                  e.target.value = '';
                  if (selected.length > 0) addFiles(selected);
                }}
                className="hidden"
              />
            </label>

            {expanding && <p className="text-xs text-muted">페이지를 불러오는 중...</p>}

            {pages.length > 0 && (
              <>
                <p className="text-xs text-muted mt-1">
                  {pages.length}장 선택됨 — 손잡이로 순서를 바꾸거나 X로 제외할 수 있어요
                </p>
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                  <SortableContext items={pages.map((p) => p.id)} strategy={horizontalListSortingStrategy}>
                    <div className="flex gap-2 overflow-x-auto py-1 -mx-1 px-1">
                      {pages.map((page, index) => (
                        <SortablePageThumb
                          key={page.id}
                          page={page}
                          index={index}
                          onRemove={() => removePage(page.id)}
                        />
                      ))}
                    </div>
                  </SortableContext>
                </DndContext>
              </>
            )}
          </div>

          {atLimit && <p className="text-sm text-red-600 dark:text-red-400">{SHEET_LIMIT_MESSAGE}</p>}
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

          <div className="flex gap-2 justify-end mt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded px-4 py-2 text-sm border border-border hover:bg-surface-hover"
            >
              취소
            </button>
            <button
              type="submit"
              disabled={loading || expanding || atLimit}
              className="bg-accent text-accent-foreground rounded px-4 py-2 text-sm hover:bg-accent-hover disabled:opacity-50"
            >
              {loading ? '업로드 중...' : '추가하기'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

interface SortablePageThumbProps {
  page: PendingPage;
  index: number;
  onRemove: () => void;
}

function SortablePageThumb({ page, index, onRemove }: SortablePageThumbProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: page.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={`relative shrink-0 w-16 h-24 border border-border rounded overflow-hidden bg-surface-hover touch-none cursor-grab active:cursor-grabbing ${
        isDragging ? 'opacity-60 shadow-lg z-10' : ''
      }`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={page.thumbnailUrl} alt="" draggable={false} className="w-full h-full object-contain select-none" />
      <span className="absolute bottom-0.5 left-1 text-[10px] leading-none text-white bg-black/60 rounded px-1 py-0.5">
        {index + 1}
      </span>
      <button
        type="button"
        // 드래그 손잡이와 겹쳐 있는 버튼이라, pointerdown 단계에서 이벤트가
        // 드래그 센서로 넘어가지 않게 막아야 클릭이 드래그로 씹히지 않는다.
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        className="absolute top-0.5 right-0.5 flex items-center justify-center w-4 h-4 rounded-full bg-black/70 text-white hover:bg-black"
        aria-label="이 장 제외"
      >
        <X size={10} />
      </button>
    </div>
  );
}
