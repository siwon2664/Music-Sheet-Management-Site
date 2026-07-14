'use client';

import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { isPdfFile } from '@/lib/storage';
import type { SetlistItem } from './SetlistPanel';

interface PerformanceModeProps {
  items: SetlistItem[];
  initialIndex?: number;
  onClose: () => void;
}

export default function PerformanceMode({ items, initialIndex = 0, onClose }: PerformanceModeProps) {
  const supabase = createClient();

  const [index, setIndex] = useState(initialIndex);
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const item = items[index];
  const effectiveKey = item ? item.transposedKey ?? item.originalKey : null;

  function goPrev() {
    setIndex((prev) => Math.max(0, prev - 1));
  }

  function goNext() {
    setIndex((prev) => Math.min(items.length - 1, prev + 1));
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

  useEffect(() => {
    let cancelled = false;

    async function loadPreview() {
      setLoading(true);
      setError(null);
      setSignedUrl(null);

      if (!item?.fileUrl) {
        setLoading(false);
        setError('악보 파일이 없습니다.');
        return;
      }

      const { data, error: signError } = await supabase.storage
        .from('sheets')
        .createSignedUrl(item.fileUrl, 60 * 10);

      if (cancelled) return;
      setLoading(false);

      if (signError || !data) {
        setError(signError?.message ?? '파일을 불러올 수 없습니다.');
        return;
      }

      setSignedUrl(data.signedUrl);
    }

    loadPreview();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  const isPdf = item?.fileUrl ? isPdfFile(item.fileUrl) : false;

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
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

      <div className="relative flex-1 min-h-0 flex items-center justify-center overflow-hidden">
        <button
          type="button"
          onClick={goPrev}
          disabled={index === 0}
          className="absolute left-2 top-1/2 -translate-y-1/2 z-10 text-white/70 hover:text-white disabled:opacity-20 disabled:cursor-not-allowed"
          aria-label="이전 곡"
        >
          <ChevronLeft size={48} />
        </button>

        <button
          type="button"
          onClick={goNext}
          disabled={index === items.length - 1}
          className="absolute right-2 top-1/2 -translate-y-1/2 z-10 text-white/70 hover:text-white disabled:opacity-20 disabled:cursor-not-allowed"
          aria-label="다음 곡"
        >
          <ChevronRight size={48} />
        </button>

        <div className="w-full h-full flex items-center justify-center px-16">
          {loading && <p className="text-sm text-white/50">불러오는 중...</p>}
          {!loading && error && <p className="text-sm text-red-400 px-6 text-center">{error}</p>}
          {!loading &&
            !error &&
            signedUrl &&
            (isPdf ? (
              <iframe src={signedUrl} title={item.title} className="w-full h-full bg-white" />
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
