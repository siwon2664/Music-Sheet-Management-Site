'use client';

import { useState, type DragEvent, type FormEvent } from 'react';
import { ListMusic, Plus, X } from 'lucide-react';

const PRESET_GROUPS: { label: string; items: string[] }[] = [
  { label: '송폼', items: ['Intro', 'A1', 'A2', 'A3', 'A4', 'A5', 'B1', 'B2', 'B3', 'B4', 'B5', 'C1', 'C2', 'C3', 'C4', 'C5', 'Outro'] },
  { label: '악기', items: ['신디', '일렉', '베이스', '드럼', '건반'] },
];

interface SongFormEditorProps {
  value: string[];
  onChange: (next: string[]) => void;
}

// 콘티 안에서만 곡의 진행 순서(송폼 마커 + 악기 큐)를 드래그로 편집한다.
// 여기서 만든 순서는 연주 모드에서 악보 위에 플로팅으로 표시된다.
export default function SongFormEditor({ value, onChange }: SongFormEditorProps) {
  const [open, setOpen] = useState(false);
  const [customText, setCustomText] = useState('');
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  function addMarker(marker: string) {
    const trimmed = marker.trim();
    if (!trimmed) return;
    onChange([...value, trimmed]);
  }

  function removeAt(index: number) {
    onChange(value.filter((_, i) => i !== index));
  }

  function handleDrop(e: DragEvent<HTMLDivElement>, index: number) {
    e.preventDefault();
    e.stopPropagation();
    setDragOverIndex(null);

    const fromStr = e.dataTransfer.getData('application/song-form-index');
    if (!fromStr) return;
    const from = Number(fromStr);
    if (from === index) return;

    const next = [...value];
    const [moved] = next.splice(from, 1);
    const adjusted = from < index ? index - 1 : index;
    next.splice(adjusted, 0, moved);
    onChange(next);
  }

  function handleCustomSubmit(e: FormEvent) {
    e.preventDefault();
    addMarker(customText);
    setCustomText('');
  }

  return (
    <div className="pl-7">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className={`flex items-center gap-1 text-xs font-medium border rounded px-2 py-1 hover:bg-gray-50 ${
          open ? 'bg-gray-900 text-white border-gray-900 hover:bg-gray-900' : 'bg-white text-gray-600'
        }`}
      >
        <ListMusic size={12} />
        {open ? '순서 편집 닫기' : value.length > 0 ? '순서 편집' : '순서 추가'}
      </button>

      {value.length > 0 && !open && (
        <div className="flex flex-wrap items-center gap-1 mt-1.5">
          {value.map((marker, index) => (
            <span key={`${marker}-${index}`} className="flex items-center gap-1">
              {index > 0 && <span className="text-gray-300 text-xs">→</span>}
              <span className="text-[11px] font-medium bg-gray-900 text-white rounded px-1.5 py-0.5">
                {marker}
              </span>
            </span>
          ))}
        </div>
      )}

      {open && (
        <div className="mt-2 border rounded-lg p-2.5 bg-gray-50 flex flex-col gap-2.5">
          <div className="bg-white border rounded-lg p-2 flex flex-col gap-1.5">
            <span className="text-[10px] font-medium text-gray-400">현재 순서</span>
            {value.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {value.map((marker, index) => (
                  <div
                    key={`${marker}-${index}`}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData('application/song-form-index', String(index));
                      e.dataTransfer.effectAllowed = 'move';
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragOverIndex(index);
                    }}
                    onDragLeave={() => setDragOverIndex((cur) => (cur === index ? null : cur))}
                    onDragEnd={() => setDragOverIndex(null)}
                    onDrop={(e) => handleDrop(e, index)}
                    className={`flex items-center gap-1 text-xs font-medium bg-gray-900 text-white rounded px-2 py-1 cursor-grab active:cursor-grabbing ${
                      dragOverIndex === index ? 'ring-2 ring-black' : ''
                    }`}
                  >
                    {marker}
                    <button
                      type="button"
                      onClick={() => removeAt(index)}
                      className="text-white/60 hover:text-white"
                      aria-label="삭제"
                    >
                      <X size={10} />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[11px] text-gray-300">아래에서 골라 순서를 만들어보세요</p>
            )}
          </div>

          <div className="flex flex-col gap-1.5 border-t border-gray-200 pt-2">
            {PRESET_GROUPS.map((group) => (
              <div key={group.label} className="flex flex-wrap items-center gap-1">
                <span className="text-[10px] text-gray-400 w-8 shrink-0">{group.label}</span>
                {group.items.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => addMarker(preset)}
                    className="text-xs border rounded px-1.5 py-0.5 bg-white hover:bg-gray-100"
                  >
                    {preset}
                  </button>
                ))}
              </div>
            ))}
          </div>

          <form onSubmit={handleCustomSubmit} className="flex items-center gap-1.5">
            <input
              type="text"
              value={customText}
              onChange={(e) => setCustomText(e.target.value)}
              placeholder="직접 입력 (예: 코러스)"
              className="flex-1 min-w-0 border rounded px-2 py-1 text-xs"
            />
            <button
              type="submit"
              className="flex items-center gap-1 text-xs border rounded px-2 py-1 bg-white hover:bg-gray-100 shrink-0"
            >
              <Plus size={12} />
              추가
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
