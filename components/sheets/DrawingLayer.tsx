'use client';

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Eraser, Highlighter, Pencil, Trash2, Undo2, WifiOff } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { getCachedDrawing } from '@/lib/offlineSheetCache';
import type { Json } from '@/types/supabase';

interface Stroke {
  color: string;
  width: number;
  points: [number, number][]; // 0~1로 정규화된 좌표
  isEraser?: boolean;
  isHighlighter?: boolean;
}

type Tool = 'pen' | 'highlighter' | 'eraser';

const ERASER_WIDTH_MULTIPLIER = 4;
const HIGHLIGHTER_WIDTH_MULTIPLIER = 3;
const HIGHLIGHTER_OPACITY = 0.4;

interface DrawingLayerProps {
  sheetId: string;
  teamId: string;
  // 연주 모드처럼 기존 마킹을 보여주기만 하고 편집 도구는 노출하지 않을 때 false로 설정.
  interactive?: boolean;
}

const COLORS = ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7', '#111827'];
const WIDTHS = [2, 4, 8];

export default function DrawingLayer({ sheetId, teamId, interactive = true }: DrawingLayerProps) {
  const supabase = createClient();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const rowIdRef = useRef<string | null>(null);
  const strokesRef = useRef<Stroke[]>([]);
  const activeStrokeRef = useRef<Stroke | null>(null);
  const activePointerIdRef = useRef<number | null>(null);

  const [active, setActive] = useState(false);
  const [tool, setTool] = useState<Tool>('pen');
  const [color, setColor] = useState(COLORS[0]);
  const [penWidth, setPenWidth] = useState(WIDTHS[1]);
  const [strokeCount, setStrokeCount] = useState(0);
  const [saving, setSaving] = useState(false);
  const [offlineSaveFailed, setOfflineSaveFailed] = useState(false);

  function redraw() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const all = activeStrokeRef.current
      ? [...strokesRef.current, activeStrokeRef.current]
      : strokesRef.current;

    for (const stroke of all) {
      if (stroke.points.length < 2) continue;
      ctx.globalCompositeOperation = stroke.isEraser ? 'destination-out' : 'source-over';
      ctx.globalAlpha = stroke.isHighlighter ? HIGHLIGHTER_OPACITY : 1;
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = stroke.width;
      ctx.lineCap = stroke.isHighlighter ? 'square' : 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(stroke.points[0][0] * w, stroke.points[0][1] * h);
      for (const [x, y] of stroke.points.slice(1)) ctx.lineTo(x * w, y * h);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }

  function resizeCanvas() {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const rect = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, rect.width * dpr);
    canvas.height = Math.max(1, rect.height * dpr);
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    redraw();
  }

  // 이 악보에 대한 내 기존 드로잉 불러오기
  useEffect(() => {
    let cancelled = false;

    async function load() {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user || cancelled) return;

      // 오프라인이면 조회 자체를 건너뛰고 바로 캐시를 쓴다. 온라인이면 최신
      // 데이터를 우선 시도하고, 그 요청이 실패했을 때만 캐시로 폴백한다.
      if (navigator.onLine) {
        const { data, error } = await supabase
          .from('drawings')
          .select('id, coordinates')
          .eq('sheet_id', sheetId)
          .eq('user_id', user.id)
          .eq('page_number', 1)
          .maybeSingle();

        if (cancelled) return;

        if (!error) {
          rowIdRef.current = data?.id ?? null;
          const parsed = data?.coordinates as unknown as { strokes?: Stroke[] } | null;
          strokesRef.current = parsed?.strokes ?? [];
          setStrokeCount(strokesRef.current.length);
          redraw();
          return;
        }
      }

      const cached = await getCachedDrawing(sheetId, user.id);
      if (cancelled) return;
      strokesRef.current = (cached as Stroke[] | null) ?? [];
      setStrokeCount(strokesRef.current.length);
      redraw();
    }

    load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheetId]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(resizeCanvas);
    observer.observe(container);
    resizeCanvas();
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function getNormalizedPoint(e: ReactPointerEvent<HTMLCanvasElement>): [number, number] | null {
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    return [(e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height];
  }

  function handlePointerDown(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (!active) return;
    // 애플펜슬로 필기하는 도중 손바닥이 화면에 닿아도 별도의 터치 포인터로
    // 필기를 방해하지 않도록, 이미 진행 중인 포인터가 있으면 새 입력은 무시한다.
    if (activePointerIdRef.current !== null) return;

    const point = getNormalizedPoint(e);
    if (!point) return;

    e.preventDefault();
    activePointerIdRef.current = e.pointerId;

    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // 일부 환경에서 포인터 캡처가 불가능해도 그리기 자체는 계속 진행한다.
    }
    const widthMultiplier =
      tool === 'eraser' ? ERASER_WIDTH_MULTIPLIER : tool === 'highlighter' ? HIGHLIGHTER_WIDTH_MULTIPLIER : 1;

    activeStrokeRef.current = {
      color,
      width: penWidth * widthMultiplier,
      points: [point],
      isEraser: tool === 'eraser',
      isHighlighter: tool === 'highlighter',
    };
    redraw();
  }

  function handlePointerMove(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (!active || !activeStrokeRef.current) return;
    if (e.pointerId !== activePointerIdRef.current) return;
    const point = getNormalizedPoint(e);
    if (!point) return;
    e.preventDefault();
    activeStrokeRef.current.points.push(point);
    redraw();
  }

  function handlePointerUp(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (e.pointerId !== activePointerIdRef.current) return;
    activePointerIdRef.current = null;

    const stroke = activeStrokeRef.current;
    activeStrokeRef.current = null;
    if (stroke && stroke.points.length > 1) {
      strokesRef.current = [...strokesRef.current, stroke];
      setStrokeCount(strokesRef.current.length);
      void persist(strokesRef.current);
    }
    redraw();
  }

  async function persist(nextStrokes: Stroke[]) {
    setSaving(true);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setSaving(false);
      return;
    }

    // 오프라인이면 저장 요청은 어차피 실패할 수밖에 없으니, 네트워크 요청
    // 자체를 시도하지 않고 바로 "저장 안 됨" 상태로 안내한다. 이 상태의
    // 필기를 로컬에 큐잉했다가 재연결 시 동기화하는 것은 이번 범위에서 제외.
    if (!navigator.onLine) {
      setOfflineSaveFailed(true);
      setSaving(false);
      return;
    }

    const payload = { strokes: nextStrokes } as unknown as Json;
    let saveError = false;

    if (rowIdRef.current) {
      const { error } = await supabase.from('drawings').update({ coordinates: payload }).eq('id', rowIdRef.current);
      saveError = !!error;
    } else {
      const { data, error } = await supabase
        .from('drawings')
        .insert({
          sheet_id: sheetId,
          team_id: teamId,
          user_id: user.id,
          page_number: 1,
          coordinates: payload,
        })
        .select('id')
        .single();
      if (data) rowIdRef.current = data.id;
      saveError = !!error;
    }

    setOfflineSaveFailed(saveError);
    setSaving(false);
  }

  function handleUndo() {
    strokesRef.current = strokesRef.current.slice(0, -1);
    setStrokeCount(strokesRef.current.length);
    redraw();
    void persist(strokesRef.current);
  }

  function handleClear() {
    if (!confirm('내 마킹을 모두 지울까요?')) return;
    strokesRef.current = [];
    setStrokeCount(0);
    redraw();
    void persist([]);
  }

  return (
    <div ref={containerRef} className="absolute inset-0 select-none [-webkit-touch-callout:none]">
      <canvas
        ref={canvasRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        style={{ touchAction: 'none' }}
        className={`absolute inset-0 select-none [-webkit-touch-callout:none] ${
          active && interactive ? 'cursor-crosshair' : 'pointer-events-none'
        }`}
      />

      {interactive && (
      <div
        onClick={(e) => e.stopPropagation()}
        className="absolute bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-black/80 rounded-full px-3 py-2 flex-wrap justify-center max-w-[95%]"
      >
        <button
          type="button"
          onClick={() => setActive((prev) => !prev)}
          className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
            active ? 'bg-white text-black' : 'text-white hover:bg-white/20'
          }`}
          aria-label="드로잉 모드"
        >
          <Pencil size={16} />
        </button>

        {active && (
          <>
            <div className="w-px h-5 bg-white/20 shrink-0" />

            <button
              type="button"
              onClick={() => setTool('pen')}
              className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                tool === 'pen' ? 'bg-white text-black' : 'text-white hover:bg-white/20'
              }`}
              aria-label="펜"
            >
              <Pencil size={16} />
            </button>

            <button
              type="button"
              onClick={() => setTool('highlighter')}
              className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                tool === 'highlighter' ? 'bg-white text-black' : 'text-white hover:bg-white/20'
              }`}
              aria-label="형광펜"
            >
              <Highlighter size={16} />
            </button>

            <button
              type="button"
              onClick={() => setTool('eraser')}
              className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                tool === 'eraser' ? 'bg-white text-black' : 'text-white hover:bg-white/20'
              }`}
              aria-label="지우개"
            >
              <Eraser size={16} />
            </button>

            <div className="w-px h-5 bg-white/20 shrink-0" />

            {tool !== 'eraser' && (
              <>
                {COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    className={`w-6 h-6 rounded-full shrink-0 border-2 ${
                      color === c ? 'border-white' : 'border-transparent'
                    }`}
                    style={{ backgroundColor: c }}
                    aria-label={`색상 ${c}`}
                  />
                ))}

                <input
                  type="color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  className="w-6 h-6 rounded-full overflow-hidden border-0 bg-transparent shrink-0 p-0"
                  aria-label="사용자 지정 색상"
                />

                <div className="w-px h-5 bg-white/20 shrink-0" />
              </>
            )}

            {WIDTHS.map((w) => (
              <button
                key={w}
                type="button"
                onClick={() => setPenWidth(w)}
                className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                  penWidth === w ? 'bg-white/20' : ''
                }`}
                aria-label={`굵기 ${w}`}
              >
                <span className="rounded-full bg-white block" style={{ width: w + 2, height: w + 2 }} />
              </button>
            ))}

            <div className="w-px h-5 bg-white/20 shrink-0" />

            <button
              type="button"
              onClick={handleUndo}
              disabled={strokeCount === 0}
              className="w-8 h-8 rounded-full flex items-center justify-center text-white hover:bg-white/20 disabled:opacity-30 shrink-0"
              aria-label="실행 취소"
            >
              <Undo2 size={16} />
            </button>

            <button
              type="button"
              onClick={handleClear}
              disabled={strokeCount === 0}
              className="w-8 h-8 rounded-full flex items-center justify-center text-white hover:bg-white/20 disabled:opacity-30 shrink-0"
              aria-label="모두 지우기"
            >
              <Trash2 size={16} />
            </button>

            {saving && <span className="text-[10px] text-white/50 shrink-0">저장 중...</span>}
            {!saving && offlineSaveFailed && (
              <span className="flex items-center gap-1 text-[10px] text-amber-400 shrink-0">
                <WifiOff size={12} />
                오프라인이라 저장 안 됨
              </span>
            )}
          </>
        )}
      </div>
      )}
    </div>
  );
}
