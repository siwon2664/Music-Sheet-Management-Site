'use client';

import { useEffect, useRef, useState } from 'react';
import DrawingLayer from './DrawingLayer';
import { detectContentBoxForImageUrl, FULL_CONTENT_BOX, type ContentBoxFraction } from '@/lib/contentBox';

interface StageRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface ImageDrawingStageProps {
  src: string;
  alt: string;
  sheetId: string;
  teamId: string;
  interactive?: boolean;
}

// 이미지도 PdfPageViewer와 같은 방식으로: 컨테이너를 꽉 채우되, 파일마다
// 제각각인 흰 여백은 제외한 실제 내용 영역 기준으로 최대 크기를 계산해
// 캔버스에 그린다. 드로잉 캔버스는 이 표시용 캔버스의 실제 위치/크기에
// 정확히 겹치도록 배치한다.
export default function ImageDrawingStage({
  src,
  alt,
  sheetId,
  teamId,
  interactive = true,
}: ImageDrawingStageProps) {
  const outerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const boxRef = useRef<ContentBoxFraction>(FULL_CONTENT_BOX);
  const [stageRect, setStageRect] = useState<StageRect | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  function render() {
    const outer = outerRef.current;
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!outer || !canvas || !img) return;

    const containerWidth = outer.clientWidth;
    const containerHeight = outer.clientHeight;
    if (containerWidth === 0 || containerHeight === 0) return;

    const box = boxRef.current;
    const sx = box.left * img.naturalWidth;
    const sy = box.top * img.naturalHeight;
    const sw = (box.right - box.left) * img.naturalWidth;
    const sh = (box.bottom - box.top) * img.naturalHeight;
    if (sw <= 0 || sh <= 0) return;

    const scale = Math.min(containerWidth / sw, containerHeight / sh);
    const outputScale = window.devicePixelRatio || 1;

    const dw = Math.max(1, Math.round(sw * scale * outputScale));
    const dh = Math.max(1, Math.round(sh * scale * outputScale));
    const cssWidth = dw / outputScale;
    const cssHeight = dh / outputScale;

    canvas.width = dw;
    canvas.height = dh;
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${cssHeight}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, dw, dh);

    // getBoundingClientRect로 재는 대신 레이아웃(items-center justify-center)을
    // 그대로 계산한다 — 로딩 표시가 막 사라진 시점처럼 캔버스가 아직 화면에
    // 반영되기 전에 이 함수가 실행되면 실측값이 0으로 나와 드로잉 버튼이 영영
    // 나타나지 않는 경우가 있었다(악보마다 타이밍이 달라 어떤 건 보이고
    // 어떤 건 안 보이는 것처럼 보였음).
    setStageRect({
      left: (containerWidth - cssWidth) / 2,
      top: (containerHeight - cssHeight) / 2,
      width: cssWidth,
      height: cssHeight,
    });
  }

  // 실제 표시용 이미지는 CORS 설정 없이 그대로 불러온다(항상 로드/표시가
  // 보장되도록). 여백 감지는 별도의 익명 CORS 이미지로 시도하고, 지원되지
  // 않는 환경이면 조용히 원본 그대로(여백 트리밍 없이) 표시한다.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    boxRef.current = FULL_CONTENT_BOX;

    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      imgRef.current = img;
      setLoading(false);
      render();
    };
    img.onerror = () => {
      if (cancelled) return;
      setLoading(false);
      setError(true);
    };
    img.src = src;

    detectContentBoxForImageUrl(src).then((box) => {
      if (cancelled) return;
      boxRef.current = box;
      render();
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  useEffect(() => {
    const outer = outerRef.current;
    if (!outer) return;
    const observer = new ResizeObserver(render);
    observer.observe(outer);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={outerRef}
      className="relative w-full h-full flex items-center justify-center select-none [-webkit-touch-callout:none]"
    >
      {loading && <p className="text-sm text-white/50">불러오는 중...</p>}
      {!loading && error && <p className="text-sm text-red-400 px-6 text-center">이미지를 불러오지 못했습니다.</p>}
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={alt}
        className={`block select-none [-webkit-touch-callout:none] ${loading || error ? 'hidden' : ''}`}
      />
      {stageRect && !loading && !error && (
        <div
          style={{
            position: 'absolute',
            left: stageRect.left,
            top: stageRect.top,
            width: stageRect.width,
            height: stageRect.height,
          }}
        >
          <DrawingLayer sheetId={sheetId} teamId={teamId} interactive={interactive} />
        </div>
      )}
    </div>
  );
}
