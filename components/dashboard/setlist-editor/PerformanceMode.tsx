'use client';

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Check, X } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { isPdfFile } from '@/lib/storage';
import { cacheDrawing, cacheSheetFile, isSheetCached } from '@/lib/offlineSheetCache';
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
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});
  const [preloading, setPreloading] = useState(true);
  const [preloadError, setPreloadError] = useState<string | null>(null);
  // 오프라인에서도 계속 볼 수 있게 파일이 로컬에 저장된 곡의 sheetId 모음.
  const [cachedSheetIds, setCachedSheetIds] = useState<Set<string>>(new Set());
  const [cacheChecked, setCacheChecked] = useState(false);

  const item = items[index];
  const effectiveKey = item ? item.transposedKey ?? item.originalKey : null;

  const dragStartRef = useRef<{ x: number; y: number } | null>(null);

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

  // 이 콘티의 곡 중 파일이 이미 로컬에 저장되어 있는 곡이 무엇인지 미리
  // 확인해둔다. signed URL 발급이 실패하거나 오프라인이어도 이 정보로 캐시
  // 폴백이 가능한지 바로 판단할 수 있다.
  useEffect(() => {
    let cancelled = false;

    async function checkExisting() {
      const entries = await Promise.all(
        items.map(async (it) => [it.sheetId, await isSheetCached(it.sheetId, it.updatedAt)] as const)
      );
      if (cancelled) return;
      setCachedSheetIds(new Set(entries.filter(([, cached]) => cached).map(([sheetId]) => sheetId)));
      setCacheChecked(true);
    }

    checkExisting();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 곡을 넘길 때마다 signed URL을 새로 발급받으면 그때마다 네트워크 왕복이 생겨
  // 딜레이가 느껴진다. 연주 모드에 들어가는 시점에 콘티 전체의 signed URL을
  // 한 번에 받아두고, 곡 전환은 이미 받아둔 URL을 그냥 꺼내 쓰기만 한다.
  useEffect(() => {
    let cancelled = false;

    async function preloadAll() {
      setPreloading(true);
      setPreloadError(null);

      const validItems = items.filter(
        (it): it is SetlistItem & { fileUrl: string } => !!it.fileUrl
      );

      if (validItems.length === 0) {
        if (!cancelled) setPreloading(false);
        return;
      }

      // 오프라인이면 signed URL 발급 자체가 의미 없으니 네트워크 시도를
      // 건너뛰고, 이미 캐시된 곡으로만 진행할 수 있게 한다.
      if (!navigator.onLine) {
        if (!cancelled) {
          setPreloadError('오프라인 상태입니다. 이전에 열어본 곡만 볼 수 있습니다.');
          setPreloading(false);
        }
        return;
      }

      try {
        const { data, error: signError } = await supabase.storage
          .from('sheets')
          .createSignedUrls(
            validItems.map((it) => it.fileUrl),
            60 * 60
          );

        if (cancelled) return;

        if (signError || !data) {
          setPreloadError(signError?.message ?? '악보를 불러오지 못했습니다.');
          setPreloading(false);
          return;
        }

        const map: Record<string, string> = {};
        validItems.forEach((it, i) => {
          const url = data[i]?.signedUrl;
          if (url) map[it.id] = url;
        });

        setSignedUrls(map);
        setPreloading(false);
      } catch (err) {
        // 온라인으로 보이지만 실제 요청이 네트워크 오류로 실패한 경우(캡티브
        // 포털 등)도 여기서 잡아 캐시 폴백이 가능하도록 한다.
        if (cancelled) return;
        setPreloadError(err instanceof Error ? err.message : '네트워크 오류');
        setPreloading(false);
      }
    }

    preloadAll();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // URL을 다 받으면 파일 자체(이미지/PDF)도 백그라운드에서 미리 받아 sheetId
  // 기준으로 영구 저장해둔다(단순 HTTP 캐시 워밍업이 아니라 실제 Blob 저장).
  // 온라인 연습 때 콘티를 한 번 훑어보면, 공연 중 네트워크가 끊겨도 이 저장된
  // 파일로 계속 볼 수 있게 하기 위함이다.
  useEffect(() => {
    let cancelled = false;

    async function cacheAll() {
      for (const it of items) {
        if (cancelled) return;
        const url = signedUrls[it.id];
        if (!url) continue;

        try {
          const res = await fetch(url);
          if (!res.ok) continue;
          const blob = await res.blob();
          if (cancelled) return;
          await cacheSheetFile(it.sheetId, it.updatedAt, blob);
          if (!cancelled) {
            setCachedSheetIds((prev) => new Set(prev).add(it.sheetId));
          }
        } catch {
          // 이 곡 캐싱에 실패해도 나머지 곡은 계속 시도한다.
        }
      }
    }

    if (Object.keys(signedUrls).length > 0) {
      cacheAll();
    }

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedUrls]);

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

  const signedUrl = item?.id ? signedUrls[item.id] ?? null : null;
  const hasCachedCurrent = item?.sheetId ? cachedSheetIds.has(item.sheetId) : false;
  const canRenderOffline = hasCachedCurrent && !!item?.sheetId && !!item?.updatedAt;
  const loading = preloading || !cacheChecked;
  const error = !item?.fileUrl
    ? '악보 파일이 없습니다.'
    : !loading && !signedUrl && !canRenderOffline
      ? preloadError ?? '파일을 불러올 수 없습니다.'
      : null;

  const isPdf = item?.fileUrl ? isPdfFile(item.fileUrl) : false;
  const cachedCount = cachedSheetIds.size;

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col touch-none">
      <div className="flex items-stretch border-b border-white/15 text-white/90">
        <div className="min-w-0 flex-1 border-r border-white/15 px-4 py-3">
          <p className="font-semibold truncate flex items-center gap-1.5">
            {item?.title}
            {hasCachedCurrent && (
              <span title="오프라인 저장됨" className="inline-flex text-green-400 shrink-0">
                <Check size={14} />
              </span>
            )}
          </p>
          <p className="text-xs text-white/50 mt-0.5">
            {index + 1} / {items.length}
            {cacheChecked && <span className="ml-2 text-white/30">· 오프라인 저장 {cachedCount}/{items.length}</span>}
          </p>
        </div>
        <div className="shrink-0 flex items-center gap-3 px-4 py-3">
          <div className="text-right">
            {effectiveKey && <p className="text-sm font-semibold">Key {effectiveKey}</p>}
            {item?.bpm && <p className="text-xs text-white/50 mt-0.5">{item.bpm} BPM</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 text-white/70 hover:text-white p-1"
            aria-label="연주 모드 종료"
          >
            <X size={24} />
          </button>
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
        <div className="w-full h-full flex items-center justify-center">
          {loading && <p className="text-sm text-white/50">불러오는 중...</p>}
          {!loading && error && <p className="text-sm text-red-400 px-6 text-center">{error}</p>}
          {!loading &&
            !error &&
            (signedUrl || canRenderOffline) &&
            item?.sheetId &&
            (isPdf ? (
              <div className="relative w-full h-full select-none [-webkit-touch-callout:none]">
                <PdfPageViewer src={signedUrl ?? ''} sheetId={item.sheetId} updatedAt={item.updatedAt} />
                <DrawingLayer sheetId={item.sheetId} teamId={teamId} interactive={false} />
              </div>
            ) : (
              <ImageDrawingStage
                src={signedUrl ?? ''}
                alt={item.title}
                sheetId={item.sheetId}
                updatedAt={item.updatedAt}
                teamId={teamId}
                interactive={false}
              />
            ))}
        </div>
      </div>

      {item?.note && (
        <div className="px-4 py-3 text-center text-sm text-white/80 bg-white/5">{item.note}</div>
      )}
    </div>
  );
}
