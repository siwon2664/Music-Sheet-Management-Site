'use client';

import { useEffect, useRef, useState } from 'react';

interface PdfPageViewerProps {
  src: string;
}

// 브라우저 내장 PDF 뷰어(iframe)는 파일마다 원본 페이지 크기에 따라 배율이 제각각이라
// 악보마다 화면에 보이는 크기가 들쭉날쭉했다. pdf.js로 직접 캔버스에 그려서
// 이미지 악보(object-contain)와 동일하게, 페이지 전체가 잘리지 않고 컨테이너
// 안에 다 들어오도록(가로/세로 둘 다 맞춰서) 렌더링한다.
export default function PdfPageViewer({ src }: PdfPageViewerProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const pagesRef = useRef<HTMLDivElement>(null);
  const renderIdRef = useRef(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let resizeTimeout: ReturnType<typeof setTimeout>;

    // 초기 로드와 ResizeObserver의 최초 콜백이 거의 동시에 render()를 부를 수 있어서,
    // 세대(generation) 번호로 뒤늦게 끝나는 이전 호출의 결과물이 DOM에 붙지 않도록 막는다.
    // 이게 없으면 같은 페이지가 중복으로 쌓여 보이는 문제가 생긴다.
    async function render() {
      const myRenderId = ++renderIdRef.current;
      const scroller = scrollRef.current;
      const pagesContainer = pagesRef.current;
      if (!scroller || !pagesContainer) return;

      setLoading(true);
      setError(null);

      try {
        const pdfjsLib = await import('pdfjs-dist');
        pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

        const pdf = await pdfjsLib.getDocument(src).promise;
        if (renderIdRef.current !== myRenderId) return;

        const containerWidth = scroller.clientWidth;
        const containerHeight = scroller.clientHeight;
        pagesContainer.innerHTML = '';

        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
          if (renderIdRef.current !== myRenderId) return;
          const page = await pdf.getPage(pageNumber);
          if (renderIdRef.current !== myRenderId) return;

          const unscaledViewport = page.getViewport({ scale: 1 });
          const scale = Math.min(
            containerWidth / unscaledViewport.width,
            containerHeight / unscaledViewport.height
          );
          const viewport = page.getViewport({ scale });

          const outputScale = window.devicePixelRatio || 1;
          const canvas = document.createElement('canvas');
          canvas.width = Math.floor(viewport.width * outputScale);
          canvas.height = Math.floor(viewport.height * outputScale);
          canvas.style.width = `${viewport.width}px`;
          canvas.style.height = `${viewport.height}px`;
          canvas.style.display = 'block';
          if (pageNumber < pdf.numPages) canvas.style.marginBottom = '8px';

          const ctx = canvas.getContext('2d');
          if (!ctx) continue;

          await page.render({
            canvasContext: ctx,
            viewport,
            transform: outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : undefined,
          }).promise;

          if (renderIdRef.current !== myRenderId) return;
          pagesContainer.appendChild(canvas);
        }
      } catch {
        if (renderIdRef.current === myRenderId) setError('PDF를 불러오지 못했습니다.');
      } finally {
        if (renderIdRef.current === myRenderId) setLoading(false);
      }
    }

    render();

    const scroller = scrollRef.current;
    const observer = scroller
      ? new ResizeObserver(() => {
          clearTimeout(resizeTimeout);
          resizeTimeout = setTimeout(render, 200);
        })
      : null;
    if (scroller) observer?.observe(scroller);

    return () => {
      renderIdRef.current += 1;
      clearTimeout(resizeTimeout);
      observer?.disconnect();
    };
  }, [src]);

  return (
    <div
      ref={scrollRef}
      className="relative w-full h-full overflow-auto bg-white select-none [-webkit-touch-callout:none]"
    >
      {loading && <p className="text-sm text-gray-400 p-4">불러오는 중...</p>}
      {error && <p className="text-sm text-red-500 p-4">{error}</p>}
      <div ref={pagesRef} className="flex flex-col items-center" />
    </div>
  );
}
