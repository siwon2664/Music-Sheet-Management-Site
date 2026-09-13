'use client';

import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type TouchEvent as ReactTouchEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Download, MoreVertical, Play, Trash2 } from 'lucide-react';
import {
  DndContext,
  DragOverlay,
  closestCenter,
  MouseSensor,
  TouchSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type MouseSensorOptions,
  type TouchSensorOptions,
} from '@dnd-kit/core';
import { arrayMove, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
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

// dnd-kit 기본 센서는 어느 엘리먼트에서 눌렀든 무조건 드래그를 시도한다 — 버튼이나
// 입력창 위에서도 예외를 두지 않는다. 콘티 카드 전체에 드래그 리스너를 걸면서도
// 버튼·입력창(및 data-no-dnd로 표시한 영역, 예: 곡 제목·송폼 마커 편집기)에서는
// 절대 드래그가 시작되지 않게 하려고, 실제로 누른 엘리먼트를 보고 걸러내는 센서를
// 직접 만든다. 반대로 data-dnd-handle이 붙은 엘리먼트(그립 아이콘)는 <button>이어도
// 예외적으로 허용해서 전용 손잡이로 계속 쓸 수 있게 한다.
function isDndBlockedTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest('[data-dnd-handle]')) return false;
  return !!target.closest('button, input, select, textarea, a, label, [data-no-dnd]');
}

// 마우스: 기존과 동일하게 약간만 움직여도(8px) 바로 드래그로 인식한다 — 클릭과
// 구분하기 위한 최소한의 여유일 뿐, 마우스에는 롱프레스 개념이 필요 없다.
class FilteredMouseSensor extends MouseSensor {
  static activators = [
    {
      eventName: 'onMouseDown' as const,
      handler: (event: ReactMouseEvent, options: MouseSensorOptions) => {
        if (isDndBlockedTarget(event.nativeEvent.target)) return false;
        return MouseSensor.activators[0].handler(event, options);
      },
    },
  ];
}

// 터치: 일정 거리 안에서 일정 시간(delay) 이상 눌러야("길게 누르면") 드래그가
// 시작된다. delay가 지나기 전에 손가락이 tolerance 이상 움직이면 스크롤로 보고
// 드래그 활성화를 취소하므로, 짧게 훑어 스크롤하는 동작과 자연스럽게 구분된다.
class FilteredTouchSensor extends TouchSensor {
  static activators = [
    {
      eventName: 'onTouchStart' as const,
      handler: (event: ReactTouchEvent, options: TouchSensorOptions) => {
        if (isDndBlockedTarget(event.nativeEvent.target)) return false;
        return TouchSensor.activators[0].handler(event, options);
      },
    },
  ];
}

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

  // 자동저장: items가 바뀔 때마다 debounce 타이머를 새로 걸고, 타이머가 끝나면
  // 그 시점의 최신 items로 저장한다. setTimeout 콜백 안에서는 클로저로 캡처된
  // 오래된 items를 보게 되므로, 항상 최신 값을 들고 있는 ref를 따로 둬서 읽는다.
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 최초 마운트 시 initialItems로 items가 세팅되는 것까지 저장 대상으로 잡으면
  // 페이지를 열기만 해도 불필요한 delete+insert가 발생하므로, 첫 렌더는 건너뛴다.
  const isFirstRenderRef = useRef(true);

  // 라이브러리 카드 드래그(악보 추가)와 콘티 목록 내부 순서 변경(dnd-kit sortable)을
  // 하나의 DndContext에서 함께 처리한다 — 마우스/터치 센서를 따로 둬서, 모바일에서도
  // 라이브러리 카드나 콘티 카드를 길게 눌러 끌 수 있다(아래 sensors 참고).
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
    useSensor(FilteredMouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(FilteredTouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
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
      thumbnailUrl: sheet.thumbnail_url,
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
    // dnd-kit의 arrayMove를 그대로 쓴다 — 직접 splice로 구현했을 때, 앞→뒤로 옮기는
    // 경우(예: 1번을 2번 자리로) toIndex를 한 칸 당겨 계산하는 실수가 있어서 바로
    // 다음 자리로 옮기는 게 통째로 씹히는(제자리로 되돌아가는) 버그가 있었다.
    setItems((prev) => arrayMove(prev, fromIndex, toIndex));
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
    setDragOverIndex(resolveLibraryInsertIndex(event));
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
      const index = resolveLibraryInsertIndex(event);
      if (index === null) return;
      addSheet(data.sheet, index);
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

  // activatorEvent(드래그 시작 시점의 원래 이벤트)의 좌표에 delta(시작 이후 누적 이동량)를
  // 더해서 "지금 포인터가 화면 어디에 있는지"를 구한다. dnd-kit이 매 프레임 좌표를 따로
  // 넘겨주지 않아서, DragOverEvent/DragEndEvent 어디서든 이 방식으로 재구성해 쓴다.
  function getPointerPosition(event: {
    activatorEvent: Event;
    delta: { x: number; y: number };
  }): { x: number; y: number } | null {
    const native = event.activatorEvent;
    if (!(native instanceof MouseEvent) && !(native instanceof PointerEvent) && !(native instanceof TouchEvent)) {
      return null;
    }
    const point =
      native instanceof TouchEvent
        ? native.touches[0] ?? native.changedTouches[0]
        : (native as MouseEvent);
    if (!point) return null;

    return { x: point.clientX + event.delta.x, y: point.clientY + event.delta.y };
  }

  // over가 정확히 안 잡혀도, 실제로 포인터가 있는 화면 좌표 아래에 라이브러리 패널이
  // 있으면 "라이브러리 위에 있다"고 판정한다. dnd-kit의 사각형 충돌 판정이 다른 큰
  // 드롭 영역(콘티 목록 컨테이너 등)과 애매하게 겹칠 때를 보완하는 용도.
  function isPointOverLibrary(event: { activatorEvent: Event; delta: { x: number; y: number } }): boolean {
    const point = getPointerPosition(event);
    if (!point) return false;
    const el = document.elementFromPoint(point.x, point.y);
    return !!el?.closest(`[data-drop-zone="${LIBRARY_DROP_ID}"]`);
  }

  // 라이브러리 카드를 콘티 목록 위로 끌고 있을 때, 지금 놓으면 몇 번째 자리에 들어갈지
  // 계산한다. "지금 어떤 곡 위에 있는가"만 보면 그 곡 앞에만 끼워 넣을 수 있다 —
  // closestCenter 특성상 콘티 목록 전체를 감싸는 "맨 끝" 드롭 영역(SETLIST_DROP_END_ID)은
  // 목록이 꽉 차 있으면 그 중심이 항상 어느 항목보다 멀어서 사실상 선택될 일이 없고,
  // 결과적으로 마지막 곡 아래쪽으로 끌어도 "마지막 곡 앞"으로만 끼워지고 맨 끝에는
  // 절대 추가되지 않는 문제가 있었다. 그래서 지금 놓인 곡 카드의 위쪽 절반인지
  // 아래쪽 절반인지까지 포인터 좌표로 확인해서, 아래쪽 절반이면 그 곡 "다음" 자리로
  // 끼워 넣는다.
  //
  // over가 콘티 목록의 실제 항목(또는 맨 끝 영역)으로 잡혔다면 그 판정을 최우선으로
  // 믿는다 — isPointOverLibrary(화면 좌표 보정)를 먼저 물어보면, 마지막 곡보다
  // 한참 아래(두 패널 사이 여백, 라이브러리 패널 맨 위쪽 언저리)까지 끌었을 때
  // 좌표상 라이브러리 쪽에 살짝 걸쳤다는 이유로 유효한 "맨 끝에 추가" 판정을 통째로
  // 취소해버리는 문제가 있었다. isPointOverLibrary는 over가 콘티 쪽 항목으로 전혀
  // 안 잡혔을 때(라이브러리 카드 위, 또는 애매한 곳)에만 최후 확인용으로 쓴다.
  function resolveLibraryInsertIndex(event: {
    over: { id: string | number; rect: { top: number; height: number } } | null;
    activatorEvent: Event;
    delta: { x: number; y: number };
  }): number | null {
    const { over } = event;

    if (over) {
      if (over.id === SETLIST_DROP_END_ID) {
        return items.length;
      }

      const index = items.findIndex((item) => item.id === over.id);
      if (index !== -1) {
        const point = getPointerPosition(event);
        if (point) {
          const midpointY = over.rect.top + over.rect.height / 2;
          if (point.y > midpointY) return index + 1;
        }
        return index;
      }
    }

    // 여기까지 왔으면 over가 콘티 목록 항목이 아니다 — 진짜로 라이브러리 위인지
    // 화면 좌표로 한 번 더 확인해서, 맞으면 취소하고 아니면 일단 맨 끝에 추가한다.
    if (!over || over.id === LIBRARY_DROP_ID || isPointOverLibrary(event)) {
      return null;
    }

    return items.length;
  }

  // 악보의 bpm은 콘티 소속이 아니라 악보 자체의 값이라, 콘티를 저장하기 전이라도
  // 바로 sheets 테이블에 반영해서 다음에 이 악보를 쓸 때도 값이 남아있게 한다.
  async function updateSheetBpm(sheetId: string, bpm: number | null) {
    setSheets((prev) => prev.map((s) => (s.id === sheetId ? { ...s, bpm } : s)));
    setItems((prev) => prev.map((item) => (item.sheetId === sheetId ? { ...item, bpm } : item)));

    const { error: updateError } = await supabase.from('sheets').update({ bpm }).eq('id', sheetId);
    if (updateError) setError(updateError.message);
  }

  // handleSave(수동 저장)와 자동저장 타이머 콜백이 공유하는 실제 저장 로직.
  // 항상 "현재 setlist_sheets 행을 전부 지우고 넘겨받은 items로 다시 채우는" 방식이라,
  // 다른 기기가 먼저 저장해둔 내용을 이 함수 호출 시점의 로컬 items가 그대로 덮어쓸 수
  // 있다 — 같은 콘티를 동시에 열어놓고 편집하는 상황이면 나중에 저장되는 쪽이 이긴다.
  // 자동저장이 debounce로 저장 주기를 짧게 만들어서 이 위험을 줄여주긴 하지만 완전히
  // 없애주지는 않는다는 점은 알아두고 쓴다.
  async function persistItems(itemsToSave: SetlistItem[]): Promise<boolean> {
    setSaving(true);
    setError(null);

    const { error: deleteError } = await supabase
      .from('setlist_sheets')
      .delete()
      .eq('setlist_id', setlistId);

    if (deleteError) {
      setSaving(false);
      setError(deleteError.message);
      return false;
    }

    if (itemsToSave.length > 0) {
      const { error: insertError } = await supabase.from('setlist_sheets').insert(
        itemsToSave.map((item, index) => ({
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
        return false;
      }
    }

    setSaving(false);
    setSaved(true);
    return true;
  }

  // 대기 중인 자동저장 타이머가 있으면 취소하고 지금 즉시 저장한다 — 수동 저장 버튼과
  // 탭을 닫거나 다른 화면으로 이동하기 직전(아래 beforeunload/언마운트 effect)에 쓴다.
  function flushPendingSave() {
    if (!saveTimeoutRef.current) return;
    clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = null;
    void persistItems(itemsRef.current);
  }

  function scheduleAutosave() {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      saveTimeoutRef.current = null;
      void persistItems(itemsRef.current);
    }, 1200);
  }

  // items가 바뀔 때마다(곡 추가/삭제/순서변경/Key·BPM·메모·송폼 수정) 자동저장을 예약한다.
  // 타이핑처럼 짧은 시간에 여러 번 바뀌는 경우 매번 저장하지 않도록 1.2초 debounce.
  useEffect(() => {
    if (isFirstRenderRef.current) {
      isFirstRenderRef.current = false;
      return;
    }
    scheduleAutosave();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  // 탭을 닫거나(beforeunload) 이 화면을 벗어날 때(언마운트) 아직 저장 안 된 변경사항이
  // 남아있다면 바로 저장을 시도한다. 브라우저 탭을 강제로 닫는 경우까지 100% 보장하진
  // 못하지만(비동기 요청이라 완료 전에 끊길 수 있음), 앱 안에서 다른 화면으로 이동하는
  // 경우엔 요청이 계속 진행되므로 실질적으로 대부분의 케이스를 커버한다.
  useEffect(() => {
    function handleBeforeUnload() {
      flushPendingSave();
    }
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      flushPendingSave();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSave() {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }
    const ok = await persistItems(items);
    if (ok) router.refresh();
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
        <p className="text-sm text-muted">곡을 추가하고 순서·Key·메모를 정리하세요. 변경사항은 잠시 후 자동으로 저장됩니다.</p>
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
