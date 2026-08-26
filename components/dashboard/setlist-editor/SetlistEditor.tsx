'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Download, MoreVertical, Play, Trash2 } from 'lucide-react';
import {
  DndContext,
  DragOverlay,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { createClient } from '@/lib/supabase/client';
import { exportSetlistToPdf } from '@/lib/exportSetlistPdf';
import SheetLibraryPanel, { LIBRARY_DROP_ID, type LibrarySheet } from './SheetLibraryPanel';
import SetlistPanel, { SETLIST_DROP_END_ID, type SetlistItem } from './SetlistPanel';
import PerformanceMode from './PerformanceMode';
import type { TeamRole } from '@/types/supabase';

interface SetlistEditorProps {
  setlistId: string;
  setlistTitle: string;
  teamId: string;
  role: TeamRole;
  sheets: LibrarySheet[];
  initialItems: SetlistItem[];
}

let tempIdCounter = 0;

export default function SetlistEditor({
  setlistId,
  setlistTitle,
  teamId,
  role,
  sheets: initialSheets,
  initialItems,
}: SetlistEditorProps) {
  const router = useRouter();
  const supabase = createClient();

  const [sheets, setSheets] = useState<LibrarySheet[]>(initialSheets);
  const [items, setItems] = useState<SetlistItem[]>(initialItems);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [performanceMode, setPerformanceMode] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const [showDownloadModal, setShowDownloadModal] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  // 라이브러리 카드 드래그(악보 추가)와 콘티 목록 내부 순서 변경(dnd-kit sortable)을
  // 하나의 DndContext에서 함께 처리한다 — PointerSensor라 마우스/터치 모두 동일하게
  // 동작해서, 모바일에서도 라이브러리 카드를 끌어 콘티 목록에 추가할 수 있다.
  const [draggingSheet, setDraggingSheet] = useState<LibrarySheet | null>(null);
  // 콘티 목록 안의 곡을 끄는 중일 때 — DragOverlay로 반투명 미리보기 카드를 띄워서
  // 커서를 따라다니게 한다. (DragOverlay가 있으면 원본 카드 자체의 이동은 dnd-kit이
  // 자동으로 꺼버리고 제자리에서 흐려지기만 하므로, 커서를 따라가는 시각 효과는
  // 이 오버레이가 전담한다.)
  const [draggingItem, setDraggingItem] = useState<SetlistItem | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  // 콘티 안의 곡을 라이브러리 쪽으로 끌고 가는 중 — true면 라이브러리 패널에
  // "놓으면 삭제됩니다" 안내를 보여준다.
  const [deleteTarget, setDeleteTarget] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setMenuOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const addedSheetIds = useMemo(() => new Set(items.map((item) => item.sheetId)), [items]);

  function addSheet(sheet: LibrarySheet, atIndex?: number) {
    if (addedSheetIds.has(sheet.id)) return;
    setSaved(false);

    const newItem: SetlistItem = {
      id: `temp-${sheet.id}-${tempIdCounter++}`,
      sheetId: sheet.id,
      title: sheet.title,
      originalKey: sheet.key,
      transposedKey: null,
      note: '',
      fileUrl: sheet.file_url,
      songForm: [],
      bpm: sheet.bpm,
      updatedAt: sheet.updated_at,
    };

    setItems((prev) => {
      const next = [...prev];
      next.splice(atIndex ?? next.length, 0, newItem);
      return next;
    });
  }

  function removeItem(index: number) {
    setSaved(false);
    setItems((prev) => prev.filter((_, i) => i !== index));
  }

  function updateItem(index: number, patch: Partial<SetlistItem>) {
    setSaved(false);
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }

  function moveItem(fromIndex: number, toIndex: number) {
    if (fromIndex === toIndex) return;
    setSaved(false);
    setItems((prev) => {
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      const adjustedTo = fromIndex < toIndex ? toIndex - 1 : toIndex;
      next.splice(adjustedTo, 0, moved);
      return next;
    });
  }

  function handleDragStart(event: DragStartEvent) {
    const data = event.active.data.current as { type?: string; sheet?: LibrarySheet } | undefined;
    if (data?.type === 'library' && data.sheet) {
      setDraggingSheet(data.sheet);
      return;
    }
    const item = items.find((i) => i.id === event.active.id);
    if (item) setDraggingItem(item);
  }

  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event;
    const data = active.data.current as { type?: string } | undefined;
    const isLibraryDrag = data?.type === 'library';

    if (!isLibraryDrag) {
      // 콘티 안의 곡을 라이브러리 쪽으로 끌고 가는 중인지만 확인한다 — 삭제 안내 표시용.
      // (콘티 내부 순서 변경 자체는 dnd-kit의 useSortable 애니메이션으로 충분히 보여준다.)
      setDeleteTarget(over?.id === LIBRARY_DROP_ID || isPointOverLibrary(event));
      setDragOverIndex(null);
      return;
    }

    setDeleteTarget(false);

    // 라이브러리 카드를 다시 라이브러리 쪽으로(또는 아무 데도 아닌 곳으로) 끌고 가는
    // 중에는 콘티 목록에 삽입선을 보여주지 않는다 — 여기서 놓아도 아무 일도 안 일어난다.
    if (!over || over.id === LIBRARY_DROP_ID || isPointOverLibrary(event)) {
      setDragOverIndex(null);
      return;
    }

    if (over.id === SETLIST_DROP_END_ID) {
      setDragOverIndex(items.length);
      return;
    }

    const index = items.findIndex((item) => item.id === over.id);
    setDragOverIndex(index === -1 ? items.length : index);
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setDraggingSheet(null);
    setDraggingItem(null);
    setDragOverIndex(null);
    setDeleteTarget(false);

    const data = active.data.current as { type?: string; sheet?: LibrarySheet } | undefined;

    // dnd-kit의 사각형 충돌 판정이 큰 컨테이너끼리 애매하게 겹칠 때 종종 놓치는 경우가
    // 있어서, 실제로 포인터가 놓인 화면 좌표로도 한 번 더 확인한다 — 훨씬 확실하다.
    const droppedOnLibrary = over?.id === LIBRARY_DROP_ID || isPointOverLibrary(event);

    if (data?.type === 'library' && data.sheet) {
      // 라이브러리 카드를 다시 라이브러리 쪽에 놓으면 아무 일도 하지 않는다.
      if (droppedOnLibrary) return;
      if (!over) return;
      const index =
        over.id === SETLIST_DROP_END_ID ? items.length : items.findIndex((item) => item.id === over.id);
      addSheet(data.sheet, index === -1 ? items.length : index);
      return;
    }

    // 콘티 안의 곡을 라이브러리 쪽으로 끌어다 놓으면 삭제할지 확인한다.
    if (droppedOnLibrary) {
      const index = items.findIndex((item) => item.id === active.id);
      if (index === -1) return;
      const item = items[index];
      if (confirm(`"${item.title}"을(를) 콘티에서 삭제할까요?`)) {
        removeItem(index);
      }
      return;
    }

    if (!over || active.id === over.id) return;
    const fromIndex = items.findIndex((item) => item.id === active.id);
    const toIndex = items.findIndex((item) => item.id === over.id);
    if (fromIndex === -1 || toIndex === -1) return;
    moveItem(fromIndex, toIndex);
  }

  // over가 정확히 안 잡혀도, 실제로 포인터가 있는 화면 좌표 아래에 라이브러리 패널이
  // 있으면 "라이브러리 위에 있다"고 판정한다. dnd-kit의 사각형 충돌 판정이 다른 큰
  // 드롭 영역(콘티 목록 컨테이너 등)과 애매하게 겹칠 때를 보완하는 용도.
  function isPointOverLibrary(event: { activatorEvent: Event; delta: { x: number; y: number } }): boolean {
    const native = event.activatorEvent;
    if (!(native instanceof MouseEvent) && !(native instanceof PointerEvent) && !(native instanceof TouchEvent)) {
      return false;
    }
    const point =
      native instanceof TouchEvent
        ? native.touches[0] ?? native.changedTouches[0]
        : (native as MouseEvent);
    if (!point) return false;

    const x = point.clientX + event.delta.x;
    const y = point.clientY + event.delta.y;
    const el = document.elementFromPoint(x, y);
    return !!el?.closest(`[data-drop-zone="${LIBRARY_DROP_ID}"]`);
  }

  // 악보의 bpm은 콘티 소속이 아니라 악보 자체의 값이라, 콘티를 저장하기 전이라도
  // 바로 sheets 테이블에 반영해서 다음에 이 악보를 쓸 때도 값이 남아있게 한다.
  async function updateSheetBpm(sheetId: string, bpm: number | null) {
    setSheets((prev) => prev.map((s) => (s.id === sheetId ? { ...s, bpm } : s)));
    setItems((prev) => prev.map((item) => (item.sheetId === sheetId ? { ...item, bpm } : item)));

    const { error: updateError } = await supabase.from('sheets').update({ bpm }).eq('id', sheetId);
    if (updateError) setError(updateError.message);
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSaved(false);

    const { error: deleteError } = await supabase
      .from('setlist_sheets')
      .delete()
      .eq('setlist_id', setlistId);

    if (deleteError) {
      setSaving(false);
      setError(deleteError.message);
      return;
    }

    if (items.length > 0) {
      const { error: insertError } = await supabase.from('setlist_sheets').insert(
        items.map((item, index) => ({
          setlist_id: setlistId,
          sheet_id: item.sheetId,
          team_id: teamId,
          sort_order: index,
          transposed_key: item.transposedKey,
          note: item.note || null,
          song_form: item.songForm,
        }))
      );

      if (insertError) {
        setSaving(false);
        setError(insertError.message);
        return;
      }
    }

    setSaving(false);
    setSaved(true);
    router.refresh();
  }

  async function handleDeleteSetlist() {
    if (!confirm('이 콘티를 삭제할까요? 되돌릴 수 없습니다.')) return;

    setDeleting(true);
    setError(null);

    const { error: deleteError } = await supabase.from('setlists').delete().eq('id', setlistId);

    if (deleteError) {
      setDeleting(false);
      setError(deleteError.message);
      return;
    }

    router.push('/dashboard');
    router.refresh();
  }

  async function handleDownload(includeNotes: boolean) {
    setDownloading(true);
    setDownloadError(null);

    try {
      const { blob, skipped } = await exportSetlistToPdf(
        supabase,
        items.map((item) => ({ title: item.title, fileUrl: item.fileUrl, note: item.note })),
        { includeNotes }
      );

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${setlistTitle || '콘티'}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      if (skipped.length > 0) {
        setDownloadError(`다음 악보는 포함하지 못했습니다: ${skipped.join(', ')}`);
      } else {
        setShowDownloadModal(false);
      }
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : '다운로드에 실패했습니다.');
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm text-muted">곡을 추가하고 순서·Key·메모를 정리한 뒤 저장하세요.</p>
        <div className="flex items-center gap-3">
          {saved && <span className="text-sm text-green-600 dark:text-green-400">저장됨</span>}
          {error && <span className="text-sm text-red-600 dark:text-red-400">{error}</span>}
          <button
            type="button"
            onClick={() => {
              // 전체화면 요청은 반드시 사용자 클릭 이벤트 안에서 동기적으로 호출해야
              // 브라우저가 허용한다 (useEffect 등 비동기 시점에서는 거부될 수 있음).
              document.documentElement.requestFullscreen?.().catch(() => {});
              setPerformanceMode(true);
            }}
            disabled={items.length === 0}
            className="flex items-center gap-1.5 border border-border rounded px-4 py-2 text-sm font-medium hover:bg-surface-hover disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Play size={14} />
            연주 시작
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="bg-accent text-accent-foreground rounded px-4 py-2 text-sm font-medium hover:bg-accent-hover disabled:opacity-50"
          >
            {saving ? '저장 중...' : '콘티 저장하기'}
          </button>
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              onClick={() => setMenuOpen((prev) => !prev)}
              className="flex items-center justify-center w-9 h-9 border border-border rounded hover:bg-surface-hover"
              aria-label="콘티 메뉴"
            >
              <MoreVertical size={16} />
            </button>

            {menuOpen && (
              <div className="absolute right-0 mt-2 w-44 bg-surface text-foreground border border-border rounded-lg shadow-lg py-1 z-50">
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    setDownloadError(null);
                    setShowDownloadModal(true);
                  }}
                  disabled={items.length === 0}
                  className="w-full flex items-center gap-2 px-4 py-2 text-sm hover:bg-surface-hover disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Download size={14} />
                  콘티 다운로드
                </button>

                {role === 'LEADER' && (
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      handleDeleteSetlist();
                    }}
                    disabled={deleting}
                    className="w-full flex items-center gap-2 px-4 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 disabled:opacity-50"
                  >
                    <Trash2 size={14} />
                    {deleting ? '삭제 중...' : '콘티 삭제'}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <SheetLibraryPanel
            sheets={sheets}
            teamId={teamId}
            addedSheetIds={addedSheetIds}
            onAdd={(sheet) => addSheet(sheet)}
            isDeleteTarget={deleteTarget}
            className="order-2 lg:order-1"
          />
          <SetlistPanel
            items={items}
            teamId={teamId}
            role={role}
            dragOverIndex={dragOverIndex}
            draggingSheet={draggingSheet}
            onRemove={removeItem}
            onUpdate={updateItem}
            onUpdateBpm={updateSheetBpm}
            className="order-1 lg:order-2"
          />
        </div>

        {/*
          dnd-kit이 만드는 오버레이 바깥 래퍼는 기본적으로 pointer-events를 막지 않는다.
          그래서 커서 좌표로 "지금 뭐 위에 있나" 확인하는 isPointOverLibrary가, 실제로는
          그 아래 라이브러리 패널이 아니라 이 오버레이 자체를 맞혀버리는 문제가 있었다.
          래퍼까지 통째로 pointer-events-none을 줘서 클릭/히트테스트가 항상 통과하게 한다.
        */}
        <DragOverlay dropAnimation={null} className="pointer-events-none">
          {draggingSheet && (
            <div className="border border-accent rounded-lg p-3 bg-surface shadow-lg w-64 pointer-events-none">
              <p className="font-medium leading-snug truncate">{draggingSheet.title}</p>
              <p className="text-xs text-muted mt-0.5 truncate">
                {[draggingSheet.composer, draggingSheet.key, draggingSheet.bpm ? `${draggingSheet.bpm} BPM` : null]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            </div>
          )}
          {draggingItem && (
            <div className="border border-border rounded-lg p-3 bg-surface-hover shadow-lg opacity-80 w-72 pointer-events-none">
              <p className="font-medium leading-snug truncate">{draggingItem.title}</p>
              <p className="text-xs text-muted mt-0.5 truncate">
                {[
                  draggingItem.transposedKey ?? draggingItem.originalKey,
                  draggingItem.bpm ? `${draggingItem.bpm} BPM` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            </div>
          )}
        </DragOverlay>
      </DndContext>

      {performanceMode && (
        <PerformanceMode items={items} teamId={teamId} onClose={() => setPerformanceMode(false)} />
      )}

      {showDownloadModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-surface text-foreground rounded-lg shadow-lg w-full max-w-sm p-6">
            <h2 className="text-lg font-semibold mb-2">콘티 다운로드</h2>
            <p className="text-sm text-muted mb-4">
              콘티에 담긴 악보를 순서대로 합쳐서 하나의 PDF로 다운로드합니다. 곡마다 적어둔 메모도 함께
              포함할까요?
            </p>

            {downloadError && <p className="text-sm text-red-600 dark:text-red-400 mb-4">{downloadError}</p>}

            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => handleDownload(true)}
                disabled={downloading}
                className="bg-accent text-accent-foreground rounded px-4 py-2 text-sm font-medium hover:bg-accent-hover disabled:opacity-50"
              >
                {downloading ? '만드는 중...' : '메모 포함해서 다운로드'}
              </button>
              <button
                type="button"
                onClick={() => handleDownload(false)}
                disabled={downloading}
                className="border border-border rounded px-4 py-2 text-sm font-medium hover:bg-surface-hover disabled:opacity-50"
              >
                {downloading ? '만드는 중...' : '악보만 다운로드'}
              </button>
              <button
                type="button"
                onClick={() => setShowDownloadModal(false)}
                disabled={downloading}
                className="text-sm text-muted hover:text-foreground mt-1 disabled:opacity-50"
              >
                취소
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
