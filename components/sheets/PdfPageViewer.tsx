'use client';

import { useEffect, useRef, useState } from 'react';
import { detectPdfPageContentBox } from '@/lib/pdfContentBox';
import { getCachedSheetFile } from '@/lib/offlineSheetCache';

interface PdfPageViewerProps {
  src: string;
  // 오프라인 캐시 폴백에 쓰인다 — 둘 다 있어야 캐시를 조회할 수 있다.
  sheetId?: string;
  updatedAt?: string;
}

// 브라우저 내장 PDF 뷰어(iframe)는 파일마다 원본 페이지 크기에 따라 배율이 제각각이라
// 악보마다 화면에 보이는 크기가 들쭉날쭉했다. pdf.js로 직접 캔버스에 그려서
// 이미지 악보(object-contain)와 동일하게, 페이지 전체가 잘리지 않고 컨테이너
// 안에 다 들어오도록(가로/세로 둘 다 맞춰서) 렌더링한다.
export default function PdfPageViewer({ src, sheetId, updatedAt }: PdfPageViewerProps) {
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

        // 네트워크 우선: 온라인이고 src가 있으면 먼저 시도하고, 실패하거나
        // 오프라인이면 이 곡을 이전에 열어봤을 때 저장해둔 캐시로 폴백한다.
        let pdf: Awaited<ReturnType<(typeof pdfjsLib)['getDocument']>['promise']> | null = null;

        if (src && navigator.onLine) {
          try {
            pdf = await pdfjsLib.getDocument(src).promise;
          } catch {
            pdf = null;
          }
        }

        if (renderIdRef.current !== myRenderId) return;

        if (!pdf && sheetId && updatedAt) {
          const cachedBlob = await getCachedSheetFile(sheetId, updatedAt);
          if (renderIdRef.current !== myRenderId) return;
          if (cachedBlob) {
            const arrayBuffer = await cachedBlob.arrayBuffer();
            if (renderIdRef.current !== myRenderId) return;
            pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
          }
        }

        if (!pdf) {
          throw new Error(!navigator.onLine ? 'offline' : 'load-failed');
        }
        if (renderIdRef.current !== myRenderId) return;

        const containerWidth = scroller.clientWidth;
        const containerHeight = scroller.clientHeight;

        // 그리는 동안에도 화면이 비지 않도록, 기존 페이지는 그대로 둔 채
        // 새 페이지들을 다 그리고 나서 마지막에 한 번에 통째로 교체한다.
        const newCanvases: HTMLCanvasElement[] = [];

        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
          if (renderIdRef.current !== myRenderId) return;
          const page = await pdf.getPage(pageNumber);
          if (renderIdRef.current !== myRenderId) return;

          const unscaledViewport = page.getViewport({ scale: 1 });

          // 1) 저해상도로 한 번 그려서 여백을 제외한 실제 악보 내용의 경계 상자를 감지한다.
          const box = await detectPdfPageContentBox(page, unscaledViewport);
          if (renderIdRef.current !== myRenderId) return;

          // 2) 내용 영역(포인트 단위) 기준으로 컨테이너를 최대한 채우는 배율을 계산한다.
          const contentWidth = unscaledViewport.width * (box.right - box.left);
          const contentHeight = unscaledViewport.height * (box.bottom - box.top);
          const scale = Math.min(containerWidth / contentWidth, containerHeight / contentHeight);

          const outputScale = window.devicePixelRatio || 1;
          const fullViewport = page.getViewport({ scale: scale * outputScale });
          const fullCanvas = document.createElement('canvas');
          fullCanvas.width = Math.max(1, Math.ceil(fullViewport.width));
          fullCanvas.height = Math.max(1, Math.ceil(fullViewport.height));
          const fullCtx = fullCanvas.getContext('2d');
          if (!fullCtx) continue;
          await page.render({ canvasContext: fullCtx, viewport: fullViewport }).promise;
          if (renderIdRef.current !== myRenderId) return;

          // 3) 여백을 제외한 내용 영역만 잘라 실제로 보여줄 캔버스에 옮긴다.
          const sx = box.left * fullCanvas.width;
          const sy = box.top * fullCanvas.height;
          const sw = (box.right - box.left) * fullCanvas.width;
          const sh = (box.bottom - box.top) * fullCanvas.height;

          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(sw));
          canvas.height = Math.max(1, Math.round(sh));
          canvas.style.width = `${canvas.width / outputScale}px`;
          canvas.style.height = `${canvas.height / outputScale}px`;
          canvas.style.display = 'block';
          if (pageNumber < pdf.numPages) canvas.style.marginBottom = '8px';

          const ctx = canvas.getContext('2d');
          if (!ctx) continue;
          ctx.drawImage(fullCanvas, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);

          newCanvases.push(canvas);
        }

        if (renderIdRef.current !== myRenderId) return;
        pagesContainer.replaceChildren(...newCanvases);
      } catch (err) {
        if (renderIdRef.current === myRenderId) {
          setError(
            err instanceof Error && err.message === 'offline'
              ? '오프라인 상태라 이 곡은 불러올 수 없습니다.'
              : 'PDF를 불러오지 못했습니다.'
          );
          pagesContainer.replaceChildren();
        }
      } finally {
        if (renderIdRef.current === myRenderId) setLoading(false);
      }
    }

    render();

    const scroller = scrollRef.current;
    // ResizeObserver는 observe() 시작 직후 실제 크기 변화가 없어도 최초 콜백을
    // 한 번 무조건 발생시킨다. 위에서 이미 render()를 호출했으니 이 최초 콜백은
    // 무시하지 않으면 곡을 열 때마다 항상 렌더링이 중복돼 화면이 한 번 더 깜빡인다.
    let isFirstResizeCallback = true;
    const observer = scroller
      ? new ResizeObserver(() => {
          if (isFirstResizeCallback) {
            isFirstResizeCallback = false;
            return;
          }
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
  }, [src, sheetId, updatedAt]);

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
