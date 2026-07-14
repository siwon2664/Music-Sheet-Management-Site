'use client';

import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { isPdfFile } from '@/lib/storage';
import DrawingLayer from './DrawingLayer';
import ImageDrawingStage from './ImageDrawingStage';

export interface PreviewableSheet {
  id: string;
  title: string;
  key?: string | null;
  file_url: string | null;
  sheetId?: string; // 실제 sheets.id (없으면 id를 그대로 사용)
}

interface SheetPreviewModalProps {
  sheets: PreviewableSheet[];
  initialIndex: number;
  teamId: string;
  onClose: () => void;
}

export default function SheetPreviewModal({ sheets, initialIndex, teamId, onClose }: SheetPreviewModalProps) {
  const supabase = createClient();

  const [index, setIndex] = useState(initialIndex);
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const sheet = sheets[index];

  function goPrev() {
    setIndex((prev) => Math.max(0, prev - 1));
  }

  function goNext() {
    setIndex((prev) => Math.min(sheets.length - 1, prev + 1));
  }

  useEffect(() => {
    let cancelled = false;

    async function loadPreview() {
      setLoading(true);
      setError(null);
      setSignedUrl(null);

      if (!sheet?.file_url) {
        setLoading(false);
        setError('미리보기 파일이 없습니다.');
        return;
      }

      const { data, error: signError } = await supabase.storage
        .from('sheets')
        .createSignedUrl(sheet.file_url, 60 * 10);

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

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft') goPrev();
      if (e.key === 'ArrowRight') goNext();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheets.length]);

  const isPdf = sheet?.file_url ? isPdfFile(sheet.file_url) : false;
  const actualSheetId = sheet?.sheetId ?? sheet?.id;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        className="relative w-full h-full flex items-center justify-center"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute top-0 right-0 text-white/80 hover:text-white"
          aria-label="닫기"
        >
          <X size={24} />
        </button>

        <button
          type="button"
          onClick={goPrev}
          disabled={index === 0}
          className="absolute left-0 top-1/2 -translate-y-1/2 text-white/80 hover:text-white disabled:opacity-20 disabled:cursor-not-allowed"
          aria-label="이전 곡"
        >
          <ChevronLeft size={36} />
        </button>

        <button
          type="button"
          onClick={goNext}
          disabled={index === sheets.length - 1}
          className="absolute right-0 top-1/2 -translate-y-1/2 text-white/80 hover:text-white disabled:opacity-20 disabled:cursor-not-allowed"
          aria-label="다음 곡"
        >
          <ChevronRight size={36} />
        </button>

        <div className="flex flex-col items-center gap-3 max-w-4xl w-full max-h-full mx-14">
          <div className="text-center text-white">
            <p className="font-semibold">{sheet?.title}</p>
            <p className="text-xs text-white/60 mt-0.5">
              {index + 1} / {sheets.length}
              {sheet?.key ? ` · Key ${sheet.key}` : ''}
            </p>
          </div>

          <div
            className="relative bg-white rounded-lg overflow-hidden flex items-center justify-center w-full h-[75vh]"
            onClick={(e) => e.stopPropagation()}
          >
            {loading && <p className="text-sm text-gray-400">불러오는 중...</p>}
            {!loading && error && <p className="text-sm text-red-500 px-6 text-center">{error}</p>}
            {!loading && !error && signedUrl && actualSheetId && (
              <>
                {isPdf ? (
                  <div className="relative w-full h-full">
                    <iframe src={signedUrl} title={sheet.title} className="w-full h-full" />
                    <DrawingLayer sheetId={actualSheetId} teamId={teamId} />
                  </div>
                ) : (
                  <ImageDrawingStage
                    src={signedUrl}
                    alt={sheet.title}
                    sheetId={actualSheetId}
                    teamId={teamId}
                  />
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
