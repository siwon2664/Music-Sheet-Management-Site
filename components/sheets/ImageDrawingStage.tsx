'use client';

import { useEffect, useRef, useState } from 'react';
import DrawingLayer from './DrawingLayer';

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
}

// object-contain 이미지는 컨테이너 안에서 레터박싱(여백)이 생길 수 있어서,
// 드로잉 캔버스를 컨테이너 전체가 아니라 실제 렌더링된 이미지 영역에만
// 정확히 겹치도록 이미지의 실제 위치/크기를 측정해서 배치한다.
export default function ImageDrawingStage({ src, alt, sheetId, teamId }: ImageDrawingStageProps) {
  const outerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [stageRect, setStageRect] = useState<StageRect | null>(null);

  function measure() {
    const outer = outerRef.current;
    const img = imgRef.current;
    if (!outer || !img) return;

    const outerRect = outer.getBoundingClientRect();
    const imgRect = img.getBoundingClientRect();

    if (imgRect.width === 0 || imgRect.height === 0) return;

    setStageRect({
      left: imgRect.left - outerRect.left,
      top: imgRect.top - outerRect.top,
      width: imgRect.width,
      height: imgRect.height,
    });
  }

  useEffect(() => {
    const outer = outerRef.current;
    if (!outer) return;
    const observer = new ResizeObserver(measure);
    observer.observe(outer);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={outerRef}
      className="relative w-full h-full flex items-center justify-center select-none [-webkit-touch-callout:none]"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={imgRef}
        src={src}
        alt={alt}
        onLoad={measure}
        draggable={false}
        className="block max-w-full max-h-full object-contain select-none [-webkit-touch-callout:none]"
      />
      {stageRect && (
        <div
          style={{
            position: 'absolute',
            left: stageRect.left,
            top: stageRect.top,
            width: stageRect.width,
            height: stageRect.height,
          }}
        >
          <DrawingLayer sheetId={sheetId} teamId={teamId} />
        </div>
      )}
    </div>
  );
}
