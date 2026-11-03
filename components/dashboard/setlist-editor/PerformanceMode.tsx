'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Check, X } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { isPdfFile } from '@/lib/storage';
import { cacheDrawing, cacheSheetFile, getCachedSheetFile } from '@/lib/offlineSheetCache';
import { keyFromTitle } from '@/lib/setlist';
import { getSignedSheetUrls } from '@/lib/sheetStorage';
import PdfPageViewer, { getTapZone } from '@/components/sheets/PdfPageViewer';
import DrawingLayer from '@/components/sheets/DrawingLayer';
import ImageDrawingStage from '@/components/sheets/ImageDrawingStage';
import type { SetlistItem } from './SetlistPanel';

const TAP_HINT_KEY = 'performance-tap-hint-seen';

interface PerformanceModeProps {
  items: SetlistItem[];
  teamId: string;
  initialIndex?: number;
  onClose: () => void;
}

export default function PerformanceMode({ items, teamId, initialIndex = 0, onClose }: PerformanceModeProps) {
  const supabase = createClient();

  const [index, setIndex] = useState(initialIndex);
  // 곡별로 로컬(blob) URL을 미리 받아둔다 — 연주 중 곡 전환은 이 로컬 URL만 쓰고
  // 네트워크를 다시 타지 않으므로 딜레이가 없다.
  const [localUrls, setLocalUrls] = useState<Record<string, string>>({});
  const [itemErrors, setItemErrors] = useState<Record<string, string>>({});
  // 파일을 받은 것만으로는 부족하다 — PDF는 캔버스에 실제로 그려질 때까지도
  // 시간이 걸리므로, 각 곡의 뷰어가 "다 그렸다"고 알려온 것까지 준비 완료로 친다.
  const [readyIds, setReadyIds] = useState<Set<string>>(new Set());

  const item = items[index];
  const effectiveKey = item ? item.transposedKey ?? item.originalKey ?? keyFromTitle(item.title) : null;

  const rootRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const objectUrlsRef = useRef<Set<string>>(new Set());
  // 불러오기를 새로 시작하거나(다시 시도) 화면을 닫으면 값이 바뀌어, 진행 중이던 이전 작업을 무효로 만든다.
  const preloadRunRef = useRef(0);
  // 곡별 PDF 뷰어의 쪽 넘기기 함수. 있으면 페달·키보드·탭을 쪽 단위로 먼저 처리한다.
  const pageTurnersRef = useRef<Record<string, (direction: 'next' | 'prev') => void>>({});
  const currentItemIdRef = useRef(item?.id);
  currentItemIdRef.current = item?.id;
  const [showTapHint, setShowTapHint] = useState(false);

  function goPrev() {
    setIndex((prev) => Math.max(0, prev - 1));
  }

  function goNext() {
    setIndex((prev) => Math.min(items.length - 1, prev + 1));
  }

  // 곡 넘기기: 좌우로 드래그(스와이프)해서 이전/다음 곡으로 이동.
  // 세로 스크롤(다중 페이지 PDF)과 헷갈리지 않도록 가로 이동량이
  // 세로 이동량보다 뚜렷이 클 때만 곡 전환으로 인식한다.
  const SWIPE_THRESHOLD = 60;

  function turn(direction: 'next' | 'prev') {
    const pageTurner = currentItemIdRef.current ? pageTurnersRef.current[currentItemIdRef.current] : undefined;
    if (pageTurner) pageTurner(direction);
    else if (direction === 'next') goNext();
    else goPrev();
  }

  function handlePointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    dragStartRef.current = { x: e.clientX, y: e.clientY };
  }

  function handlePointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    const start = dragStartRef.current;
    dragStartRef.current = null;
    if (!start) return;

    const deltaX = e.clientX - start.x;
    const deltaY = e.clientY - start.y;

    if (Math.abs(deltaX) < 10 && Math.abs(deltaY) < 10) {
      if ((e.target as Element).closest('button')) return;
      const zone = getTapZone(e.clientX, e.currentTarget.getBoundingClientRect());
      if (zone === 'next') goNext();
      if (zone === 'prev') goPrev();
      return;
    }

    if (Math.abs(deltaX) < SWIPE_THRESHOLD || Math.abs(deltaX) < Math.abs(deltaY) * 1.5) return;

    if (deltaX > 0) goPrev();
    else goNext();
  }

  // 연주 모드가 열려있는 동안 뒤에 있는 콘티 편집 화면이 같이 스크롤/바운스되지
  // 않도록 막는다. 특히 iPad Safari는 전체화면 API가 항상 성공하는 게 아니고,
  // overflow:hidden만으로는 배경이 여전히 스크롤되거나 오버스크롤 바운스로
  // 화면 아래쪽에 뒷화면이 살짝 비쳐 보일 수 있어서, body를 fixed로 고정해
  // 뒷화면 자체를 완전히 움직이지 못하게 한다. (SheetPreviewModal과 동일한 처리)
  useEffect(() => {
    const scrollY = window.scrollY;
    const body = document.body;
    const original = {
      overflow: body.style.overflow,
      position: body.style.position,
      top: body.style.top,
      width: body.style.width,
    };

    body.style.overflow = 'hidden';
    body.style.position = 'fixed';
    body.style.top = `-${scrollY}px`;
    body.style.width = '100%';

    return () => {
      body.style.overflow = original.overflow;
      body.style.position = original.position;
      body.style.top = original.top;
      body.style.width = original.width;
      window.scrollTo(0, scrollY);
    };
  }, []);

  // 연주 중에는 뒤에 있는 편집 화면으로 포커스가 가지 않게 한다. 포커스가 "연주 시작"
  // 버튼에 남아 있으면 스페이스로 곡을 넘길 때 그 버튼까지 눌리기 때문이다.
  useEffect(() => {
    const inerted: Element[] = [];
    for (let node: Element | null = rootRef.current; node?.parentElement; node = node.parentElement) {
      for (const sibling of Array.from(node.parentElement.children)) {
        if (sibling !== node && !sibling.hasAttribute('inert') && sibling.tagName !== 'SCRIPT') {
          sibling.setAttribute('inert', '');
          inerted.push(sibling);
        }
      }
    }
    rootRef.current?.focus();
    return () => inerted.forEach((element) => element.removeAttribute('inert'));
  }, []);

  // 전체화면 진입 요청은 호출 측(버튼 클릭 핸들러)에서 이미 수행한다.
  // 여기서는 전체화면 종료를 감지해 모드를 닫고, 언마운트 시 전체화면을 해제한다.
  useEffect(() => {
    function handleFullscreenChange() {
      if (!document.fullscreenElement) onClose();
    }

    document.addEventListener('fullscreenchange', handleFullscreenChange);

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      if (document.fullscreenElement) {
        document.exitFullscreen?.().catch(() => {});
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
      // 블루투스 페달은 대개 PageUp/PageDown이나 방향키를 보낸다.
      if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(e.key)) {
        e.preventDefault();
        turn('prev');
      }
      if (['ArrowRight', 'ArrowDown', 'PageDown', ' '].includes(e.key)) {
        e.preventDefault();
        turn('next');
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.length]);

  // 연주 중에 태블릿 화면이 꺼지지 않게 한다. 탭을 벗어나면 브라우저가 풀어 버리므로 돌아올 때 다시 요청한다.
  useEffect(() => {
    let lock: WakeLockSentinel | null = null;
    let closed = false;

    async function acquire() {
      try {
        const sentinel = await navigator.wakeLock?.request('screen');
        if (closed) void sentinel?.release();
        else lock = sentinel ?? null;
      } catch {
        // 지원하지 않거나 저전력 모드면 건너뛴다.
      }
    }
    function handleVisibilityChange() {
      if (document.visibilityState === 'visible') void acquire();
    }

    void acquire();
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      closed = true;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      lock?.release().catch(() => {});
    };
  }, []);

  // 탭으로 넘길 수 있다는 걸 처음 한 번만 알려준다.
  useEffect(() => {
    try {
      if (localStorage.getItem(TAP_HINT_KEY)) return;
      localStorage.setItem(TAP_HINT_KEY, '1');
    } catch {
      return;
    }
    setShowTapHint(true);
    const timer = setTimeout(() => setShowTapHint(false), 4000);
    return () => clearTimeout(timer);
  }, []);

  const markReady = useCallback((id: string) => {
    setReadyIds((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }, []);

  // 연주 모드 시작 시점에 콘티 전체를 한 번에 준비한다: signed URL을 일괄 발급받고,
  // 곡마다 실제 파일까지 미리 내려받아 로컬(blob) URL로 바꿔둔다. 곡 전환 때마다
  // 매번 새로 네트워크를 타면(또는 PDF를 처음 열 때 디코딩하면) 그때 딜레이가
  // 느껴지므로, 그 비용을 전부 "시작" 시점(로딩 화면)으로 앞당겨서 치르고
  // 연주 중에는 이미 받아둔 로컬 URL만 쓰게 한다.
  function preload(targets: (SetlistItem & { fileUrl: string })[]) {
    const run = ++preloadRunRef.current;
    const isCancelled = () => run !== preloadRunRef.current;

    async function preloadAll() {
      if (targets.length === 0) return;

      const signedUrlMap: Record<string, string> = {};

      // 오프라인이면 signed URL 발급 자체가 의미 없으니 건너뛰고 곧바로
      // 곡마다 캐시 폴백을 시도한다.
      if (navigator.onLine) {
        try {
          const urls = await getSignedSheetUrls(targets.map((it) => it.fileUrl));
          if (!isCancelled()) {
            targets.forEach((it, i) => {
              const url = urls[i];
              if (url) signedUrlMap[it.id] = url;
            });
          }
        } catch {
          // 무시 — 아래에서 곡별 캐시 폴백으로 처리된다.
        }
      }

      if (isCancelled()) return;

      await Promise.all(
        targets.map(async (it) => {
          let blob: Blob | null = null;
          const url = signedUrlMap[it.id];

          if (url) {
            try {
              const res = await fetch(url);
              if (res.ok) blob = await res.blob();
            } catch {
              blob = null;
            }
          }

          if (isCancelled()) return;

          if (blob) {
            // 온라인 연습 때 콘티를 한 번 훑어보면, 공연 중 네트워크가 끊겨도
            // 이 저장된 파일로 계속 볼 수 있도록 영구 저장해둔다.
            cacheSheetFile(it.sheetId, it.updatedAt, blob).catch(() => {});
          } else {
            blob = await getCachedSheetFile(it.sheetId, it.updatedAt);
          }

          if (isCancelled()) return;

          if (blob) {
            const objectUrl = URL.createObjectURL(blob);
            objectUrlsRef.current.add(objectUrl);
            setLocalUrls((prev) => ({ ...prev, [it.id]: objectUrl }));
          } else if (url && !isPdfFile(it.fileUrl)) {
            // fetch만 막혔을 수 있다(R2 CORS 등). 이미지는 <img>로는 열리므로 서명 URL로
            // 바로 보여준다. 다만 파일을 받은 게 아니라 오프라인 저장은 되지 않는다.
            setLocalUrls((prev) => ({ ...prev, [it.id]: url }));
          } else {
            setItemErrors((prev) => ({
              ...prev,
              [it.id]: navigator.onLine
                ? '파일을 불러오지 못했습니다.'
                : '오프라인 상태이며 저장된 캐시가 없습니다.',
            }));
            // 파일을 못 받았으면 렌더링할 뷰어 자체가 마운트되지 않으므로,
            // 이 곡은 여기서 바로 "준비 완료(실패)"로 표시해야 전체 로딩이
            // 끝나지 않고 멈춰 있는 일이 없다.
            markReady(it.id);
          }
        })
      );
    }

    preloadAll();
  }

  useEffect(() => {
    preload(items.filter((it): it is SetlistItem & { fileUrl: string } => !!it.fileUrl));

    return () => {
      preloadRunRef.current++;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function retryFailed() {
    const failed = items.filter((it): it is SetlistItem & { fileUrl: string } => !!it.fileUrl && !!itemErrors[it.id]);
    setItemErrors({});
    setReadyIds((prev) => new Set(Array.from(prev).filter((id) => !failed.some((it) => it.id === id))));
    preload(failed);
  }

  // 언마운트(연주 모드 종료) 시 만들어둔 blob URL을 정리한다.
  useEffect(() => {
    return () => {
      objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  // 현재 로그인한 유저의 필기도 함께 캐시해둔다 — DrawingLayer는 각자 알아서
  // drawings 테이블을 조회하므로, 오프라인일 때 그 조회가 폴백할 수 있도록
  // 여기서 미리 저장해둔다.
  useEffect(() => {
    let cancelled = false;

    async function cacheDrawingsForOffline() {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user || cancelled) return;

      const sheetIds = items.map((it) => it.sheetId);
      if (sheetIds.length === 0) return;

      const { data, error } = await supabase
        .from('drawings')
        .select('sheet_id, coordinates')
        .eq('user_id', user.id)
        .eq('page_number', 1)
        .in('sheet_id', sheetIds);

      if (cancelled || error || !data) return;

      const updatedAtBySheetId = new Map(items.map((it) => [it.sheetId, it.updatedAt]));

      for (const row of data) {
        if (cancelled) return;
        const updatedAt = updatedAtBySheetId.get(row.sheet_id);
        if (!updatedAt) continue;
        const parsed = row.coordinates as unknown as { strokes?: unknown } | null;
        await cacheDrawing(row.sheet_id, user.id, updatedAt, parsed?.strokes ?? []);
      }
    }

    cacheDrawingsForOffline();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  const validItems = useMemo(
    () => items.filter((it): it is SetlistItem & { fileUrl: string } => !!it.fileUrl),
    [items]
  );

  // 콘티의 모든 곡이 (성공이든 실패든) 준비되기 전까지는 연주 화면을 열지 않는다 —
  // "시작" 버튼을 누르면 다 불러온 뒤에 시작되게 하기 위함이다.
  const loading = validItems.length > 0 && readyIds.size < validItems.length;

  const cachedSheetIds = useMemo(
    () => new Set(validItems.filter((it) => localUrls[it.id]?.startsWith('blob:')).map((it) => it.sheetId)),
    [validItems, localUrls]
  );

  const currentError = item?.id ? itemErrors[item.id] ?? null : null;
  const hasCachedCurrent = item?.sheetId ? cachedSheetIds.has(item.sheetId) : false;
  const error = !item?.fileUrl
    ? '악보 파일이 없습니다.'
    : !loading && currentError
      ? currentError
      : null;

  const cachedCount = cachedSheetIds.size;

  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label="연주 모드"
      className="fixed inset-0 z-50 bg-black flex flex-col touch-none outline-none"
    >
      <div className="flex items-stretch border-b border-white/15 text-white/90">
        {/* 왼쪽은 비워둔다 — 전체화면 상태에서 브라우저가 자체적으로 띄우는
            전체화면 종료 버튼이 이 자리(좌상단)에 겹쳐서 뜨기 때문에, 우리
            쪽 UI를 여기 두면 서로 가려서 지저분해 보인다. */}
        <div className="flex-1" aria-hidden="true" />
        <div className="min-w-0 border-r border-white/15 px-4 py-3">
          <p className="font-semibold truncate flex items-center justify-end gap-1.5">
            {item?.title}
            {hasCachedCurrent && (
              <span title="오프라인 저장됨" className="inline-flex text-green-400 shrink-0">
                <Check size={14} />
              </span>
            )}
          </p>
          <p className="text-xs text-white/50 mt-0.5 text-right">
            {index + 1} / {items.length}
            <span className="ml-2 text-white/30">· 오프라인 저장 {cachedCount}/{items.length}</span>
          </p>
        </div>
        <div className="shrink-0 w-24 flex items-center justify-end px-4 py-3">
          <div className="text-right">
            {effectiveKey && <p className="text-sm font-semibold">Key {effectiveKey}</p>}
            {item?.bpm && <p className="text-xs text-white/50 mt-0.5">{item.bpm} BPM</p>}
          </div>
        </div>
        {/* 전체화면을 지원하지 않는 기기(iPhone 등)에서는 키보드 없이 나갈 방법이 이 버튼뿐이다. */}
        <button
          type="button"
          onClick={onClose}
          aria-label="연주 모드 닫기"
          className="shrink-0 w-14 flex items-center justify-center border-l border-white/15 text-white/70 hover:text-white hover:bg-white/10"
        >
          <X size={22} />
        </button>
      </div>

      {item?.songForm && item.songForm.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-white/15 px-4 py-2">
          {item.songForm.map((marker, i) => (
            <span key={`${marker}-${i}`} className="flex items-center gap-2">
              {i > 0 && <span className="text-white/30 text-xs">→</span>}
              <span className="text-xs md:text-sm font-semibold text-white whitespace-nowrap">{marker}</span>
            </span>
          ))}
        </div>
      )}

      <div
        className="relative flex-1 min-h-0 flex items-center justify-center overflow-hidden"
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
      >
        {(loading || error) && (
          <div className="w-full h-full flex items-center justify-center">
            {loading && (
              <p className="text-sm text-white/50">
                불러오는 중... ({readyIds.size}/{validItems.length})
              </p>
            )}
            {!loading && error && (
              <div className="flex flex-col items-center gap-3 px-6">
                <p className="text-sm text-red-400 text-center">{error}</p>
                {currentError && (
                  <button
                    type="button"
                    onClick={retryFailed}
                    className="border border-white/30 rounded px-4 py-2 text-sm text-white hover:bg-white/10"
                  >
                    다시 시도
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* 콘티의 모든 곡을 미리 마운트해둔다(현재 곡만 보이게 하고 나머지는
            visibility로 숨김. display:none이면 크기가 0이라 미리 그려도 곡을 처음 넘길 때 다시 그린다) — 곡 전환 시 언마운트/리마운트가 일어나지 않아야 뷰어가 다시
            로딩·디코딩을 반복하지 않고, 이미 그려둔 화면을 그대로 즉시
            보여줄 수 있다. */}
        {validItems.map((it) => {
          const url = localUrls[it.id];
          if (!url) return null;

          const isCurrent = item?.id === it.id;
          const pdf = isPdfFile(it.fileUrl);

          return (
            <div
              key={it.id}
              className={`absolute inset-0 flex items-center justify-center ${
                isCurrent && !loading ? '' : 'invisible'
              }`}
            >
              {pdf ? (
                <div className="relative w-full h-full select-none [-webkit-touch-callout:none]">
                  {/* PdfPageViewer가 이 스와이프를 먼저 페이지 넘기기로 처리하고, 이미
                      첫/마지막 페이지라 더 넘길 페이지가 없을 때만 onOverswipe로 여기
                      알려온다 — 그때만 곡을 넘긴다. (같은 좌우 스와이프를 페이지 안에서
                      쓰고 있을 땐 PdfPageViewer가 stopPropagation으로 이 영역의 곡 전환
                      스와이프 핸들러(아래 onPointerDown/onPointerUp)로 다시 전달되는 걸
                      막아준다 — 그래서 이미지 악보에서만 쓰이는 그 핸들러와 안 겹친다.) */}
                  <PdfPageViewer
                    src={url}
                    sheetId={it.sheetId}
                    updatedAt={it.updatedAt}
                    tapToTurn
                    onRegisterTurn={(pageTurner) => {
                      pageTurnersRef.current[it.id] = pageTurner;
                    }}
                    onReady={() => markReady(it.id)}
                    onOverswipe={(direction) => (direction === 'next' ? goNext() : goPrev())}
                  />
                  <DrawingLayer sheetId={it.sheetId} teamId={teamId} interactive={false} />
                </div>
              ) : (
                <ImageDrawingStage
                  src={url}
                  alt={it.title}
                  sheetId={it.sheetId}
                  updatedAt={it.updatedAt}
                  teamId={teamId}
                  interactive={false}
                  onReady={() => markReady(it.id)}
                />
              )}
            </div>
          );
        })}
      </div>

      {showTapHint && !loading && (
        <p className="absolute bottom-16 left-1/2 -translate-x-1/2 text-sm text-white bg-black/80 rounded-full px-4 py-2 whitespace-nowrap pointer-events-none">
          화면 양쪽 끝을 누르면 넘어갑니다
        </p>
      )}

      {item?.note && (
        <div className="px-4 py-3 text-center text-sm text-white/80 bg-white/5">{item.note}</div>
      )}
    </div>
  );
}
