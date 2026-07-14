'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Play, Trash2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import SheetLibraryPanel, { type LibrarySheet } from './SheetLibraryPanel';
import SetlistPanel, { type SetlistItem } from './SetlistPanel';
import PerformanceMode from './PerformanceMode';
import type { TeamRole } from '@/types/supabase';

interface SetlistEditorProps {
  setlistId: string;
  teamId: string;
  role: TeamRole;
  sheets: LibrarySheet[];
  initialItems: SetlistItem[];
}

let tempIdCounter = 0;

export default function SetlistEditor({
  setlistId,
  teamId,
  role,
  sheets,
  initialItems,
}: SetlistEditorProps) {
  const router = useRouter();
  const supabase = createClient();

  const [items, setItems] = useState<SetlistItem[]>(initialItems);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [performanceMode, setPerformanceMode] = useState(false);

  const addedSheetIds = useMemo(() => new Set(items.map((item) => item.sheetId)), [items]);

  function addSheet(sheet: LibrarySheet, atIndex?: number) {
    if (addedSheetIds.has(sheet.id)) return;
    setSaved(false);

    const newItem: SetlistItem = {
      id: `temp-${sheet.id}-${tempIdCounter++}`,
      sheetId: sheet.id,
      title: sheet.title,
      originalKey: sheet.key,
      transposedKey: null,
      note: '',
      fileUrl: sheet.file_url,
    };

    setItems((prev) => {
      const next = [...prev];
      next.splice(atIndex ?? next.length, 0, newItem);
      return next;
    });
  }

  function removeItem(index: number) {
    setSaved(false);
    setItems((prev) => prev.filter((_, i) => i !== index));
  }

  function updateItem(index: number, patch: Partial<SetlistItem>) {
    setSaved(false);
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }

  function moveItem(fromIndex: number, toIndex: number) {
    if (fromIndex === toIndex) return;
    setSaved(false);
    setItems((prev) => {
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      const adjustedTo = fromIndex < toIndex ? toIndex - 1 : toIndex;
      next.splice(adjustedTo, 0, moved);
      return next;
    });
  }

  function dropSheetAt(sheetId: string, index: number) {
    const sheet = sheets.find((s) => s.id === sheetId);
    if (!sheet) return;
    addSheet(sheet, index);
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSaved(false);

    const { error: deleteError } = await supabase
      .from('setlist_sheets')
      .delete()
      .eq('setlist_id', setlistId);

    if (deleteError) {
      setSaving(false);
      setError(deleteError.message);
      return;
    }

    if (items.length > 0) {
      const { error: insertError } = await supabase.from('setlist_sheets').insert(
        items.map((item, index) => ({
          setlist_id: setlistId,
          sheet_id: item.sheetId,
          team_id: teamId,
          sort_order: index,
          transposed_key: item.transposedKey,
          note: item.note || null,
        }))
      );

      if (insertError) {
        setSaving(false);
        setError(insertError.message);
        return;
      }
    }

    setSaving(false);
    setSaved(true);
    router.refresh();
  }

  async function handleDeleteSetlist() {
    if (!confirm('이 콘티를 삭제할까요? 되돌릴 수 없습니다.')) return;

    setDeleting(true);
    setError(null);

    const { error: deleteError } = await supabase.from('setlists').delete().eq('id', setlistId);

    if (deleteError) {
      setDeleting(false);
      setError(deleteError.message);
      return;
    }

    router.push('/dashboard');
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm text-gray-500">곡을 추가하고 순서·Key·메모를 정리한 뒤 저장하세요.</p>
        <div className="flex items-center gap-3">
          {saved && <span className="text-sm text-green-600">저장됨</span>}
          {error && <span className="text-sm text-red-600">{error}</span>}
          {role === 'LEADER' && (
            <button
              type="button"
              onClick={handleDeleteSetlist}
              disabled={deleting}
              className="flex items-center gap-1.5 border border-red-200 text-red-600 rounded px-4 py-2 text-sm font-medium hover:bg-red-50 disabled:opacity-50"
            >
              <Trash2 size={14} />
              {deleting ? '삭제 중...' : '콘티 삭제'}
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              // 전체화면 요청은 반드시 사용자 클릭 이벤트 안에서 동기적으로 호출해야
              // 브라우저가 허용한다 (useEffect 등 비동기 시점에서는 거부될 수 있음).
              document.documentElement.requestFullscreen?.().catch(() => {});
              setPerformanceMode(true);
            }}
            disabled={items.length === 0}
            className="flex items-center gap-1.5 border rounded px-4 py-2 text-sm font-medium hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Play size={14} />
            연주 시작
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="bg-black text-white rounded px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            {saving ? '저장 중...' : '콘티 저장하기'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <SheetLibraryPanel
          sheets={sheets}
          teamId={teamId}
          addedSheetIds={addedSheetIds}
          onAdd={(sheet) => addSheet(sheet)}
        />
        <SetlistPanel
          items={items}
          teamId={teamId}
          onRemove={removeItem}
          onUpdate={updateItem}
          onMove={moveItem}
          onDropSheet={dropSheetAt}
        />
      </div>

      {performanceMode && (
        <PerformanceMode items={items} onClose={() => setPerformanceMode(false)} />
      )}
    </div>
  );
}
