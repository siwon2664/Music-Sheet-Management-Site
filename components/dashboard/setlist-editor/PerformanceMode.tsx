'use client';

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { isPdfFile } from '@/lib/storage';
import PdfPageViewer from '@/components/sheets/PdfPageViewer';
import type { SetlistItem } from './SetlistPanel';

interface PerformanceModeProps {
  items: SetlistItem[];
  initialIndex?: number;
  onClose: () => void;
}

export default function PerformanceMode({ items, initialIndex = 0, onClose }: PerformanceModeProps) {
  const supabase = createClient();

  const [index, setIndex] = useState(initialIndex);
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});
  const [preloading, setPreloading] = useState(true);
  const [preloadError, setPreloadError] = useState<string | null>(null);

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
    }

    preloadAll();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // URL을 다 받으면 파일 자체(이미지/PDF)도 백그라운드에서 미리 요청해
  // 브라우저 캐시에 데워둔다. 실제로 그 곡으로 넘어갔을 때 PdfPageViewer나
  // <img>가 네트워크가 아니라 캐시에서 바로 읽도록 하기 위함이다.
  useEffect(() => {
    Object.values(signedUrls).forEach((url) => {
      fetch(url).catch(() => {});
    });
  }, [signedUrls]);

  const signedUrl = item?.id ? signedUrls[item.id] ?? null : null;
  const loading = preloading;
  const error = !item?.fileUrl
    ? '악보 파일이 없습니다.'
    : !preloading && !signedUrl
      ? preloadError ?? '파일을 불러올 수 없습니다.'
      : null;

  const isPdf = item?.fileUrl ? isPdfFile(item.fileUrl) : false;

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col touch-none">
      <div className="flex items-center justify-between px-4 py-3 text-white/90">
        <div className="min-w-0">
          <p className="font-semibold truncate">{item?.title}</p>
          <p className="text-xs text-white/50 mt-0.5">
            {index + 1} / {items.length}
            {effectiveKey ? ` · Key ${effectiveKey}` : ''}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 text-white/70 hover:text-white p-2"
          aria-label="연주 모드 종료"
        >
          <X size={24} />
        </button>
      </div>

      <div
        className="relative flex-1 min-h-0 flex items-center justify-center overflow-hidden"
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
      >
        <button
          type="button"
          onClick={goPrev}
          disabled={index === 0}
          className="absolute left-0 top-0 h-full w-20 md:w-28 z-10 flex items-center justify-start pl-2 text-white/70 hover:text-white active:text-white disabled:opacity-20 disabled:cursor-not-allowed"
          aria-label="이전 곡"
        >
          <ChevronLeft size={48} />
        </button>

        <button
          type="button"
          onClick={goNext}
          disabled={index === items.length - 1}
          className="absolute right-0 top-0 h-full w-20 md:w-28 z-10 flex items-center justify-end pr-2 text-white/70 hover:text-white active:text-white disabled:opacity-20 disabled:cursor-not-allowed"
          aria-label="다음 곡"
        >
          <ChevronRight size={48} />
        </button>

        {item?.songForm && item.songForm.length > 0 && (
          <div className="absolute top-3 inset-x-0 z-20 flex justify-center px-4 pointer-events-none">
            <div className="max-w-full flex flex-wrap items-center justify-center gap-x-2 gap-y-1 bg-black/70 backdrop-blur-sm rounded-full px-4 py-2">
              {item.songForm.map((marker, i) => (
                <span key={`${marker}-${i}`} className="flex items-center gap-2">
                  {i > 0 && <span className="text-white/30 text-xs">→</span>}
                  <span className="text-xs md:text-sm font-semibold text-white whitespace-nowrap">
                    {marker}
                  </span>
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="w-full h-full flex items-center justify-center px-20 md:px-28">
          {loading && <p className="text-sm text-white/50">불러오는 중...</p>}
          {!loading && error && <p className="text-sm text-red-400 px-6 text-center">{error}</p>}
          {!loading &&
            !error &&
            signedUrl &&
            (isPdf ? (
              <PdfPageViewer src={signedUrl} />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={signedUrl}
                alt={item.title}
                className="max-w-full max-h-full object-contain"
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
