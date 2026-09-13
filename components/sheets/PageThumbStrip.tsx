'use client';

import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { X } from 'lucide-react';
import type { PendingPage } from '@/lib/pageCompose';

// UploadSheetModal과 EditSheetModal이 함께 쓰는 "낱장 가로 스트립" — 드래그로
// 순서를 바꾸고 X로 낱장을 뺄 수 있다. 실제 낱장 목록 상태는 부모가 들고 있고,
// 이 컴포넌트는 순수하게 보여주기 + 재배열/삭제 이벤트를 올려보내는 역할만 한다.
interface PageThumbStripProps {
  pages: PendingPage[];
  onReorder: (pages: PendingPage[]) => void;
  onRemove: (id: string) => void;
}

export default function PageThumbStrip({ pages, onReorder, onRemove }: PageThumbStripProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = pages.findIndex((p) => p.id === active.id);
    const newIndex = pages.findIndex((p) => p.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    onReorder(arrayMove(pages, oldIndex, newIndex));
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={pages.map((p) => p.id)} strategy={horizontalListSortingStrategy}>
        <div className="flex gap-2 overflow-x-auto py-1 -mx-1 px-1">
          {pages.map((page, index) => (
            <SortablePageThumb key={page.id} page={page} index={index} onRemove={() => onRemove(page.id)} />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

interface SortablePageThumbProps {
  page: PendingPage;
  index: number;
  onRemove: () => void;
}

function SortablePageThumb({ page, index, onRemove }: SortablePageThumbProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: page.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={`relative shrink-0 w-16 h-24 border border-border rounded overflow-hidden bg-surface-hover touch-none cursor-grab active:cursor-grabbing ${
        isDragging ? 'opacity-60 shadow-lg z-10' : ''
      }`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={page.thumbnailUrl} alt="" draggable={false} className="w-full h-full object-contain select-none" />
      <span className="absolute bottom-0.5 left-1 text-[10px] leading-none text-white bg-black/60 rounded px-1 py-0.5">
        {index + 1}
      </span>
      <button
        type="button"
        // 드래그 손잡이와 겹쳐 있는 버튼이라, pointerdown 단계에서 이벤트가
        // 드래그 센서로 넘어가지 않게 막아야 클릭이 드래그로 씹히지 않는다.
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        className="absolute top-0.5 right-0.5 flex items-center justify-center w-4 h-4 rounded-full bg-black/70 text-white hover:bg-black"
        aria-label="이 장 제외"
      >
        <X size={10} />
      </button>
    </div>
  );
}
