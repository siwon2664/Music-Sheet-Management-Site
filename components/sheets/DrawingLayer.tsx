'use client';

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Eraser, GripVertical, Hand, Highlighter, Pencil, Trash2, Undo2, WifiOff } from 'lucide-react';
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

// 'pan'은 그리지 않고 화면을 손가락으로 넘기거나 확대/축소할 수 있게 캔버스가
// 터치를 가로채지 않도록 하는 상태다(그리기 도구 없음 = 탐색 모드).
type Tool = 'pen' | 'highlighter' | 'eraser' | 'pan';

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

// 기본 위치(왼쪽 위)는 고정하되, 악보마다 여백 위치가 달라서 결국 뭔가는
// 가릴 수 있으니 손잡이로 끌어서 옮길 수 있게 하고, 마지막 위치를
// 기억해둔다. 기본값 자체는 바꾸지 않는다 — 이 위치가 이미 정해진 상태다.
const TOOLBAR_POS_KEY = 'bandSetlist.drawingToolbarPos';
const DEFAULT_TOOLBAR_POS = { x: 16, y: 16 }; // top-4 left-4 와 동일

interface ToolbarPos {
  x: number;
  y: number;
}

export default function DrawingLayer({ sheetId, teamId, interactive = true }: DrawingLayerProps) {
  const supabase = createClient();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const rowIdRef = useRef<string | null>(null);
  const strokesRef = useRef<Stroke[]>([]);
  const activeStrokeRef = useRef<Stroke | null>(null);
  const activePointerIdRef = useRef<number | null>(null);
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; startPosX: number; startPosY: number } | null>(
    null
  );

  // 팝업(색상/굵기 등 옵션)이 열려있는지와, 지금 어떤 도구가 선택돼 있는지는
  // 서로 별개다 — 팝업을 닫아도 펜/지우개는 계속 그 도구로 동작해야 한다.
  const [menuOpen, setMenuOpen] = useState(false);
  const [tool, setTool] = useState<Tool>('pan');
  const [color, setColor] = useState(COLORS[0]);
  const [penWidth, setPenWidth] = useState(WIDTHS[1]);
  const [strokeCount, setStrokeCount] = useState(0);
  const [saving, setSaving] = useState(false);
  const [offlineSaveFailed, setOfflineSaveFailed] = useState(false);
  const [toolbarPos, setToolbarPos] = useState<ToolbarPos>(DEFAULT_TOOLBAR_POS);
  const [dragging, setDragging] = useState(false);

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

  // 지난번에 옮겨둔 도구 모음 위치를 기억해뒀다가 그대로 복원한다.
  // 화면 크기가 그때와 다르면(기기가 바뀌었거나 회전했거나) 화면 밖으로
  // 나가지 않도록 다시 안쪽으로 붙여준다.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(TOOLBAR_POS_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as ToolbarPos;
        setToolbarPos(clampToolbarPos(parsed.x, parsed.y));
      }
    } catch {
      // 접근 불가 환경이면 그냥 기본 위치를 쓴다.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function handleResize() {
      setToolbarPos((prev) => clampToolbarPos(prev.x, prev.y));
    }
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 도구 모음은 악보를 그리는 캔버스(containerRef, 악보 실제 크기와 정확히
  // 일치해야 좌표 계산이 맞음)와 별개로 화면(viewport) 기준 fixed 위치로
  // 띄운다. 이렇게 해야 악보 영역 바깥(모달의 어두운 배경, 검은 여백 등)
  // 으로도 자유롭게 옮길 수 있다.
  function clampToolbarPos(x: number, y: number): ToolbarPos {
    const toolbar = toolbarRef.current;
    const maxX = Math.max(0, window.innerWidth - (toolbar?.offsetWidth ?? 0));
    const maxY = Math.max(0, window.innerHeight - (toolbar?.offsetHeight ?? 0));
    return { x: Math.min(Math.max(0, x), maxX), y: Math.min(Math.max(0, y), maxY) };
  }

  function handleDragHandlePointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    e.stopPropagation();
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startPosX: toolbarPos.x,
      startPosY: toolbarPos.y,
    };
    setDragging(true);
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // 포인터 캡처 불가 환경이면 그냥 계속 진행한다.
    }
  }

  function handleDragHandlePointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || e.pointerId !== drag.pointerId) return;
    e.stopPropagation();
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    setToolbarPos(clampToolbarPos(drag.startPosX + dx, drag.startPosY + dy));
  }

  function handleDragHandlePointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || e.pointerId !== drag.pointerId) return;
    e.stopPropagation();
    dragRef.current = null;
    setDragging(false);
    setToolbarPos((prev) => {
      try {
        localStorage.setItem(TOOLBAR_POS_KEY, JSON.stringify(prev));
      } catch {
        // 저장 실패해도 이번 세션에서는 이미 옮겨진 위치가 반영돼 있다.
      }
      return prev;
    });
  }

  function getNormalizedPoint(e: ReactPointerEvent<HTMLCanvasElement>): [number, number] | null {
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    return [(e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height];
  }

  function handlePointerDown(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (tool === 'pan') return;
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
    if (tool === 'pan' || !activeStrokeRef.current) return;
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

  // 접혀있을 때도 지금 어떤 도구가 선택돼 있는지 한눈에 보이도록 아이콘을 바꿔준다.
  const CurrentToolIcon =
    tool === 'highlighter' ? Highlighter : tool === 'eraser' ? Eraser : tool === 'pan' ? Hand : Pencil;

  // 실제로 그릴 수 있는 상태인지(펜/형광펜/지우개가 선택돼 있고 상호작용 가능할 때)만
  // true다. 이게 아니면(pan 도구거나 interactive=false) 이 레이어 전체(래퍼 div까지)를
  // pointer-events-none으로 비워서, 스와이프·클릭 같은 제스처가 그대로 뚫고 지나가
  // 밑에 깔린 PdfPageViewer/ImageDrawingStage에 닿도록 한다. 예전엔 <canvas>에만 이걸
  // 걸어뒀는데, 그 canvas를 담고 있는 이 래퍼 div 자체(전체 화면을 absolute inset-0로
  // 덮고 있음)는 계속 pointer-events: auto였어서 — 투명해서 안 보일 뿐 여전히 화면
  // 전체의 클릭/터치를 가로채고 있었다. 도구가 'pan'이어도(기본값) 이 래퍼가 막고
  // 있었던 셈이라, 악보 페이지 스크롤/스와이프가 전혀 먹히지 않는 원인이었다.
  const canDraw = tool !== 'pan' && interactive;

  return (
    <div
      ref={containerRef}
      className={`absolute inset-0 select-none [-webkit-touch-callout:none] ${canDraw ? '' : 'pointer-events-none'}`}
    >
      <canvas
        ref={canvasRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        style={{ touchAction: 'none' }}
        className={`absolute inset-0 select-none [-webkit-touch-callout:none] ${
          canDraw ? 'cursor-crosshair' : 'pointer-events-none'
        }`}
      />

      {interactive && (
      <div
        ref={toolbarRef}
        onClick={(e) => e.stopPropagation()}
        // 래퍼가 pointer-events-none이어도(그리는 중이 아닐 때, 즉 대부분의 경우) 도구
        // 모음 자체는 항상 눌려야 한다 — pan 상태에서도 펜으로 도구를 바꿀 수 있어야
        // 하므로, 부모의 none을 명시적으로 다시 auto로 덮어쓴다.
        style={{ left: toolbarPos.x, top: toolbarPos.y, pointerEvents: 'auto' }}
        className={`fixed z-[60] flex flex-col gap-1.5 bg-black/80 rounded-2xl p-2 w-44 max-h-[75%] overflow-y-auto ${
          dragging ? 'opacity-80' : ''
        }`}
      >
        <div className="flex items-center justify-between gap-1">
          <button
            type="button"
            onClick={() => setMenuOpen((prev) => !prev)}
            className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
              menuOpen ? 'bg-white text-black' : 'text-white hover:bg-white/20'
            }`}
            aria-label="그리기 옵션 열기/닫기"
          >
            <CurrentToolIcon size={16} />
          </button>

          <div
            onPointerDown={handleDragHandlePointerDown}
            onPointerMove={handleDragHandlePointerMove}
            onPointerUp={handleDragHandlePointerUp}
            onPointerCancel={handleDragHandlePointerUp}
            style={{ touchAction: 'none' }}
            className={`w-8 h-8 rounded-full flex items-center justify-center cursor-move shrink-0 ${
              dragging ? 'bg-white/20 text-white' : 'text-white/50'
            }`}
            aria-label="도구 모음 위치 이동 (끌어서 옮기기)"
          >
            <GripVertical size={16} />
          </div>
        </div>

        {menuOpen && (
          <div className="flex flex-wrap items-center gap-1.5 justify-center">
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

            <button
              type="button"
              onClick={() => setTool('pan')}
              className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                tool === 'pan' ? 'bg-white text-black' : 'text-white hover:bg-white/20'
              }`}
              aria-label="넘기기/확대 (그리지 않음)"
              title="넘기기/확대 (그리지 않음)"
            >
              <Hand size={16} />
            </button>

            <div className="basis-full h-px bg-white/20" />

            {tool !== 'eraser' && tool !== 'pan' && (
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

                <div className="basis-full h-px bg-white/20" />
              </>
            )}

            {tool !== 'pan' && (
              <>
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

                <div className="basis-full h-px bg-white/20" />
              </>
            )}

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

            {saving && <span className="text-[10px] text-white/50 shrink-0 text-center leading-tight">저장 중...</span>}
            {!saving && offlineSaveFailed && (
              <span className="flex flex-col items-center gap-1 text-[10px] text-amber-400 shrink-0 w-14 text-center leading-tight">
                <WifiOff size={12} />
                오프라인이라 저장 안 됨
              </span>
            )}
          </div>
        )}
      </div>
      )}
    </div>
  );
}
