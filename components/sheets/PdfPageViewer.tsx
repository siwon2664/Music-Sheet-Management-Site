'use client';

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { detectPdfPageContentBox } from '@/lib/pdfContentBox';
import { getCachedSheetFile } from '@/lib/offlineSheetCache';

interface PdfPageViewerProps {
  src: string;
  // 오프라인 캐시 폴백에 쓰인다 — 둘 다 있어야 캐시를 조회할 수 있다.
  sheetId?: string;
  updatedAt?: string;
  // 연주 모드에서 모든 곡을 미리 렌더링해둘 때, 이 곡의 렌더링이 (성공이든
  // 실패든) 끝났음을 상위 컴포넌트에 알리기 위한 콜백.
  onReady?: () => void;
  // 이미 첫/마지막 페이지인 상태에서 그 방향으로 스와이프를 한 번 더 하면 호출된다.
  // 상위 컴포넌트가 이걸 받아 "이전/다음 곡"으로 넘어가는 데 쓸 수 있다 — 페이지
  // 넘기기와 곡 넘기기를 하나의 좌우 동작으로 이어붙이는 용도.
  onOverswipe?: (direction: 'next' | 'prev') => void;
}

// 스와이프로 페이지를 넘길 때 쓰는 임계값. PerformanceMode의 곡 전환 스와이프와
// 같은 값을 써서 두 제스처가 이어붙였을 때 체감 감도가 똑같게 맞춘다.
const SWIPE_THRESHOLD = 60;

// 브라우저 내장 PDF 뷰어(iframe)는 파일마다 원본 페이지 크기에 따라 배율이 제각각이라
// 악보마다 화면에 보이는 크기가 들쭉날쭉했다. pdf.js로 직접 캔버스에 그려서
// 이미지 악보(object-contain)와 동일하게, 페이지 전체가 잘리지 않고 컨테이너
// 안에 다 들어오도록(가로/세로 둘 다 맞춰서) 렌더링한다.
//
// 여러 장짜리 PDF는 예전엔 페이지를 세로로 쌓아두고 스크롤해서 보는 방식이었다.
// 지금은 한 번에 한 페이지만 컨테이너 전체 크기로 보여주고, 좌우 스와이프로만
// 페이지를 넘기는 방식으로 바뀌었다(버튼 없음) — 페이지별로 캔버스를 미리 다
// 그려서 배열에 들고 있다가, 화면에는 현재 페이지의 캔버스 하나만 붙인다.
export default function PdfPageViewer({ src, sheetId, updatedAt, onReady, onOverswipe }: PdfPageViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const pageSlotRef = useRef<HTMLDivElement>(null);
  const canvasesRef = useRef<HTMLCanvasElement[]>([]);
  const renderIdRef = useRef(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageCount, setPageCount] = useState(0);
  // 스와이프 판정 콜백(handlePointerUp)이 항상 최신 페이지 번호를 보게 하려고
  // state와 나란히 ref로도 들고 있는다(클로저 안에서 state를 직접 읽으면 그
  // 콜백이 만들어진 시점의 값에 고정돼버린다).
  const pageIndexRef = useRef(0);

  const dragStartRef = useRef<{ x: number; y: number } | null>(null);

  const showPage = useCallback((index: number) => {
    const slot = pageSlotRef.current;
    if (!slot) return;
    const canvas = canvasesRef.current[index];
    slot.replaceChildren(...(canvas ? [canvas] : []));
  }, []);

  useEffect(() => {
    let resizeTimeout: ReturnType<typeof setTimeout>;

    // 새 문서(다른 src/sheetId/updatedAt)를 여는 경우에만 1페이지로 돌아간다.
    // 아래 ResizeObserver가 같은 문서를 다시 그릴 때는 이 값을 건드리지 않아서,
    // 화면 크기가 바뀌어도(기기 회전 등) 보고 있던 페이지가 유지된다.
    pageIndexRef.current = 0;
    setPageIndex(0);

    // 초기 로드와 ResizeObserver의 최초 콜백이 거의 동시에 render()를 부를 수 있어서,
    // 세대(generation) 번호로 뒤늦게 끝나는 이전 호출의 결과물이 DOM에 붙지 않도록 막는다.
    // 이게 없으면 같은 페이지가 중복으로 쌓여 보이는 문제가 생긴다.
    async function render() {
      const myRenderId = ++renderIdRef.current;
      const container = containerRef.current;
      if (!container) return;

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

        const containerWidth = container.clientWidth;
        const containerHeight = container.clientHeight;

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

          const ctx = canvas.getContext('2d');
          if (!ctx) continue;
          ctx.drawImage(fullCanvas, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);

          newCanvases.push(canvas);
        }

        if (renderIdRef.current !== myRenderId) return;
        canvasesRef.current = newCanvases;
        setPageCount(newCanvases.length);
        // 리사이즈로 다시 그린 경우 보던 페이지를 유지하되, 혹시(재로딩 등으로)
        // 페이지 수가 줄어들었으면 범위 안으로 당겨준다.
        const clampedIndex = Math.min(pageIndexRef.current, Math.max(0, newCanvases.length - 1));
        pageIndexRef.current = clampedIndex;
        setPageIndex(clampedIndex);
        showPage(clampedIndex);
      } catch (err) {
        if (renderIdRef.current === myRenderId) {
          setError(
            err instanceof Error && err.message === 'offline'
              ? '오프라인 상태라 이 곡은 불러올 수 없습니다.'
              : 'PDF를 불러오지 못했습니다.'
          );
          canvasesRef.current = [];
          setPageCount(0);
          pageSlotRef.current?.replaceChildren();
        }
      } finally {
        if (renderIdRef.current === myRenderId) {
          setLoading(false);
          onReady?.();
        }
      }
    }

    render();

    const container = containerRef.current;
    // ResizeObserver는 observe() 시작 직후 실제 크기 변화가 없어도 최초 콜백을
    // 한 번 무조건 발생시킨다. 위에서 이미 render()를 호출했으니 이 최초 콜백은
    // 무시하지 않으면 곡을 열 때마다 항상 렌더링이 중복돼 화면이 한 번 더 깜빡인다.
    let isFirstResizeCallback = true;
    const observer = container
      ? new ResizeObserver(() => {
          if (isFirstResizeCallback) {
            isFirstResizeCallback = false;
            return;
          }
          clearTimeout(resizeTimeout);
          resizeTimeout = setTimeout(render, 200);
        })
      : null;
    if (container) observer?.observe(container);

    return () => {
      renderIdRef.current += 1;
      clearTimeout(resizeTimeout);
      observer?.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, sheetId, updatedAt, showPage]);

  // index가 범위를 벗어나면(첫 페이지에서 더 이전으로, 마지막 페이지에서 더
  // 다음으로) 페이지를 넘기는 대신 onOverswipe로 "곡을 넘겨달라"고 알린다.
  function goToPage(index: number) {
    const count = canvasesRef.current.length;
    if (count === 0) return;
    if (index < 0) {
      onOverswipe?.('prev');
      return;
    }
    if (index >= count) {
      onOverswipe?.('next');
      return;
    }
    pageIndexRef.current = index;
    setPageIndex(index);
    showPage(index);
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
    // 세로로 더 많이 움직였거나 너무 짧게 움직인 제스처는 탭/오조작으로 보고 무시한다.
    if (Math.abs(deltaX) < SWIPE_THRESHOLD || Math.abs(deltaX) < Math.abs(deltaY) * 1.5) return;

    // 페이지 넘기기로 확실히 인식된 스와이프다 — 이 제스처가 상위(연주 모드의
    // 곡 전환 스와이프)로 또 전달돼서 같은 스와이프 한 번에 페이지도 넘어가고
    // 곡도 같이 넘어가 버리는 걸 막는다. (onOverswipe로 곡을 넘기는 경우도
    // 마찬가지 — 상위의 독립적인 스와이프 판정이 같은 제스처를 또 처리하면
    // 곡이 두 개씩 건너뛴다.)
    e.stopPropagation();

    if (deltaX > 0) goToPage(pageIndexRef.current - 1);
    else goToPage(pageIndexRef.current + 1);
  }

  const showPageBadge = !loading && !error && pageCount > 1;

  return (
    <div
      ref={containerRef}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      className="relative w-full h-full overflow-hidden bg-white select-none [-webkit-touch-callout:none] flex items-center justify-center"
    >
      {loading && <p className="text-sm text-gray-400 p-4">불러오는 중...</p>}
      {error && <p className="text-sm text-red-500 p-4">{error}</p>}
      <div ref={pageSlotRef} className="flex items-center justify-center" />

      {/* 버튼 없이 좌우 스와이프로만 페이지를 넘긴다 — 지금 몇 페이지인지만
          작게 알려준다. */}
      {showPageBadge && (
        <span className="absolute bottom-1.5 left-1/2 -translate-x-1/2 text-[11px] text-black/50 bg-white/70 rounded-full px-2 py-0.5 pointer-events-none">
          {pageIndex + 1} / {pageCount}
        </span>
      )}
    </div>
  );
}
