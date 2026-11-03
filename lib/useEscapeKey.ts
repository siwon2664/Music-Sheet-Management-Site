import { useEffect, useRef } from 'react';

// 모달을 Esc로 닫는다. 저장 중처럼 닫으면 안 될 때는 enabled를 false로 넘긴다.
export function useEscapeKey(onEscape: () => void, enabled = true) {
  const onEscapeRef = useRef(onEscape);
  onEscapeRef.current = onEscape;

  useEffect(() => {
    if (!enabled) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onEscapeRef.current();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [enabled]);
}
