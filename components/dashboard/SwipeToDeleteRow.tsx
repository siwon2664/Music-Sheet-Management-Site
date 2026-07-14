'use client';

import { useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { Trash2 } from 'lucide-react';

const REVEAL_WIDTH = 76;

interface SwipeToDeleteRowProps {
  onDelete: () => void;
  children: ReactNode;
}

export default function SwipeToDeleteRow({ onDelete, children }: SwipeToDeleteRowProps) {
  const [offset, setOffset] = useState(0);
  const [open, setOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const startX = useRef(0);
  const startOffset = useRef(0);
  const pointerId = useRef<number | null>(null);

  // 주의: 여기서 setPointerCapture를 쓰면 안 된다. 캡처를 걸면 이후의 click
  // 이벤트까지 이 div로 강제 리타겟되어, 안쪽 버튼(카드 클릭 -> 페이지 이동)의
  // onClick이 아예 발동하지 않게 된다. 대신 window에 직접 리스너를 붙여 드래그를
  // 추적하고, 클릭은 평소대로 자식 요소에 자연스럽게 전달되도록 둔다.
  function handlePointerDown(e: PointerEvent<HTMLDivElement>) {
    setDragging(true);
    startX.current = e.clientX;
    startOffset.current = offset;
    pointerId.current = e.pointerId;

    window.addEventListener('pointermove', handleWindowPointerMove);
    window.addEventListener('pointerup', handleWindowPointerUp);
    window.addEventListener('pointercancel', handleWindowPointerUp);
  }

  function handleWindowPointerMove(e: globalThis.PointerEvent) {
    if (e.pointerId !== pointerId.current) return;
    const delta = e.clientX - startX.current;
    const next = Math.min(0, Math.max(-REVEAL_WIDTH, startOffset.current + delta));
    setOffset(next);
  }

  function handleWindowPointerUp(e: globalThis.PointerEvent) {
    if (e.pointerId !== pointerId.current) return;

    window.removeEventListener('pointermove', handleWindowPointerMove);
    window.removeEventListener('pointerup', handleWindowPointerUp);
    window.removeEventListener('pointercancel', handleWindowPointerUp);

    setDragging(false);
    setOffset((current) => {
      const shouldOpen = current < -REVEAL_WIDTH / 2;
      setOpen(shouldOpen);
      return shouldOpen ? -REVEAL_WIDTH : 0;
    });
  }

  function handleContentClickCapture(e: React.MouseEvent) {
    // 열려있는 상태에서 콘텐츠를 누르면 원래 동작(이동 등) 대신 그냥 닫는다.
    if (open) {
      e.preventDefault();
      e.stopPropagation();
      setOffset(0);
      setOpen(false);
    }
  }

  return (
    <div className="relative overflow-hidden rounded">
      <button
        type="button"
        onClick={() => {
          setOffset(0);
          setOpen(false);
          onDelete();
        }}
        style={{ width: REVEAL_WIDTH }}
        className="absolute right-0 top-0 h-full bg-red-600 text-white flex flex-col items-center justify-center gap-0.5"
        aria-label="삭제"
      >
        <Trash2 size={16} />
        <span className="text-[11px]">삭제</span>
      </button>

      <div
        onPointerDown={handlePointerDown}
        onClickCapture={handleContentClickCapture}
        style={{
          transform: `translateX(${offset}px)`,
          transition: dragging ? 'none' : 'transform 150ms ease',
          touchAction: 'pan-y',
        }}
        className="relative bg-white"
      >
        {children}
      </div>
    </div>
  );
}
