'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Download, MoreVertical, Play, Trash2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { exportSetlistToPdf } from '@/lib/exportSetlistPdf';
import SheetLibraryPanel, { type LibrarySheet } from './SheetLibraryPanel';
import SetlistPanel, { type SetlistItem } from './SetlistPanel';
import PerformanceMode from './PerformanceMode';
import type { TeamRole } from '@/types/supabase';

interface SetlistEditorProps {
  setlistId: string;
  setlistTitle: string;
  teamId: string;
  role: TeamRole;
  sheets: LibrarySheet[];
  initialItems: SetlistItem[];
}

let tempIdCounter = 0;

export default function SetlistEditor({
  setlistId,
  setlistTitle,
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
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const [showDownloadModal, setShowDownloadModal] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setMenuOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

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
      songForm: [],
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
          song_form: item.songForm,
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

  async function handleDownload(includeNotes: boolean) {
    setDownloading(true);
    setDownloadError(null);

    try {
      const { blob, skipped } = await exportSetlistToPdf(
        supabase,
        items.map((item) => ({ title: item.title, fileUrl: item.fileUrl, note: item.note })),
        { includeNotes }
      );

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${setlistTitle || '콘티'}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      if (skipped.length > 0) {
        setDownloadError(`다음 악보는 포함하지 못했습니다: ${skipped.join(', ')}`);
      } else {
        setShowDownloadModal(false);
      }
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : '다운로드에 실패했습니다.');
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm text-gray-500">곡을 추가하고 순서·Key·메모를 정리한 뒤 저장하세요.</p>
        <div className="flex items-center gap-3">
          {saved && <span className="text-sm text-green-600">저장됨</span>}
          {error && <span className="text-sm text-red-600">{error}</span>}
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
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              onClick={() => setMenuOpen((prev) => !prev)}
              className="flex items-center justify-center w-9 h-9 border rounded hover:bg-gray-50"
              aria-label="콘티 메뉴"
            >
              <MoreVertical size={16} />
            </button>

            {menuOpen && (
              <div className="absolute right-0 mt-2 w-44 bg-white border rounded-lg shadow-lg py-1 z-50">
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    setDownloadError(null);
                    setShowDownloadModal(true);
                  }}
                  disabled={items.length === 0}
                  className="w-full flex items-center gap-2 px-4 py-2 text-sm hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Download size={14} />
                  콘티 다운로드
                </button>

                {role === 'LEADER' && (
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      handleDeleteSetlist();
                    }}
                    disabled={deleting}
                    className="w-full flex items-center gap-2 px-4 py-2 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50"
                  >
                    <Trash2 size={14} />
                    {deleting ? '삭제 중...' : '콘티 삭제'}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <SheetLibraryPanel
          sheets={sheets}
          teamId={teamId}
          addedSheetIds={addedSheetIds}
          onAdd={(sheet) => addSheet(sheet)}
          className="order-2 lg:order-1"
        />
        <SetlistPanel
          items={items}
          teamId={teamId}
          onRemove={removeItem}
          onUpdate={updateItem}
          onMove={moveItem}
          onDropSheet={dropSheetAt}
          className="order-1 lg:order-2"
        />
      </div>

      {performanceMode && (
        <PerformanceMode items={items} onClose={() => setPerformanceMode(false)} />
      )}

      {showDownloadModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-lg shadow-lg w-full max-w-sm p-6">
            <h2 className="text-lg font-semibold mb-2">콘티 다운로드</h2>
            <p className="text-sm text-gray-500 mb-4">
              콘티에 담긴 악보를 순서대로 합쳐서 하나의 PDF로 다운로드합니다. 곡마다 적어둔 메모도 함께
              포함할까요?
            </p>

            {downloadError && <p className="text-sm text-red-600 mb-4">{downloadError}</p>}

            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => handleDownload(true)}
                disabled={downloading}
                className="bg-black text-white rounded px-4 py-2 text-sm font-medium disabled:opacity-50"
              >
                {downloading ? '만드는 중...' : '메모 포함해서 다운로드'}
              </button>
              <button
                type="button"
                onClick={() => handleDownload(false)}
                disabled={downloading}
                className="border rounded px-4 py-2 text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
              >
                {downloading ? '만드는 중...' : '악보만 다운로드'}
              </button>
              <button
                type="button"
                onClick={() => setShowDownloadModal(false)}
                disabled={downloading}
                className="text-sm text-gray-500 hover:text-gray-900 mt-1 disabled:opacity-50"
              >
                취소
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
