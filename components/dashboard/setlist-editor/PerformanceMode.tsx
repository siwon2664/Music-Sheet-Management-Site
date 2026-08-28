'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Check } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { isPdfFile } from '@/lib/storage';
import { cacheDrawing, cacheSheetFile, getCachedSheetFile } from '@/lib/offlineSheetCache';
import PdfPageViewer from '@/components/sheets/PdfPageViewer';
import DrawingLayer from '@/components/sheets/DrawingLayer';
import ImageDrawingStage from '@/components/sheets/ImageDrawingStage';
import type { SetlistItem } from './SetlistPanel';

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
  const effectiveKey = item ? item.transposedKey ?? item.originalKey : null;

  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const objectUrlsRef = useRef<Set<string>>(new Set());

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

  function handlePointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    dragStartRef.current = { x: e.clientX, y: e.clientY };
  }

  function handlePointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    const start = dragStartRef.current;
    dragStartRef.current = null;
    if (!start) return;

    const deltaX = e.clientX - start.x;
    const deltaY = e.clientY - start.y;

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
      if (e.key === 'ArrowLeft') goPrev();
      if (e.key === 'ArrowRight' || e.key === ' ') goNext();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.length]);

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
  useEffect(() => {
    let cancelled = false;

    async function preloadAll() {
      const targets = items.filter(
        (it): it is SetlistItem & { fileUrl: string } => !!it.fileUrl
      );
      if (targets.length === 0) return;

      let signedUrlMap: Record<string, string> = {};

      // 오프라인이면 signed URL 발급 자체가 의미 없으니 건너뛰고 곧바로
      // 곡마다 캐시 폴백을 시도한다.
      if (navigator.onLine) {
        try {
          const { data } = await supabase.storage
            .from('sheets')
            .createSignedUrls(
              targets.map((it) => it.fileUrl),
              60 * 60
            );
          if (!cancelled && data) {
            targets.forEach((it, i) => {
              const url = data[i]?.signedUrl;
              if (url) signedUrlMap[it.id] = url;
            });
          }
        } catch {
          // 무시 — 아래에서 곡별 캐시 폴백으로 처리된다.
        }
      }

      if (cancelled) return;

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

          if (cancelled) return;

          if (blob) {
            // 온라인 연습 때 콘티를 한 번 훑어보면, 공연 중 네트워크가 끊겨도
            // 이 저장된 파일로 계속 볼 수 있도록 영구 저장해둔다.
            cacheSheetFile(it.sheetId, it.updatedAt, blob).catch(() => {});
          } else {
            blob = await getCachedSheetFile(it.sheetId, it.updatedAt);
          }

          if (cancelled) return;

          if (blob) {
            const objectUrl = URL.createObjectURL(blob);
            objectUrlsRef.current.add(objectUrl);
            setLocalUrls((prev) => ({ ...prev, [it.id]: objectUrl }));
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

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    () => new Set(validItems.filter((it) => localUrls[it.id]).map((it) => it.sheetId)),
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
    <div className="fixed inset-0 z-50 bg-black flex flex-col touch-none">
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
        <div className="shrink-0 flex items-center px-4 py-3">
          <div className="text-right">
            {effectiveKey && <p className="text-sm font-semibold">Key {effectiveKey}</p>}
            {item?.bpm && <p className="text-xs text-white/50 mt-0.5">{item.bpm} BPM</p>}
          </div>
        </div>
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
            {!loading && error && <p className="text-sm text-red-400 px-6 text-center">{error}</p>}
          </div>
        )}

        {/* 콘티의 모든 곡을 미리 마운트해둔다(현재 곡만 보이게 하고 나머지는
            숨김) — 곡 전환 시 언마운트/리마운트가 일어나지 않아야 뷰어가 다시
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
                isCurrent && !loading ? '' : 'hidden'
              }`}
            >
              {pdf ? (
                <div className="relative w-full h-full select-none [-webkit-touch-callout:none]">
                  <PdfPageViewer
                    src={url}
                    sheetId={it.sheetId}
                    updatedAt={it.updatedAt}
                    onReady={() => markReady(it.id)}
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

      {item?.note && (
        <div className="px-4 py-3 text-center text-sm text-white/80 bg-white/5">{item.note}</div>
      )}
    </div>
  );
}
