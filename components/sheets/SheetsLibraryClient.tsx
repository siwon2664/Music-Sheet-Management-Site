'use client';

import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  CalendarPlus,
  Plus,
  Search,
  Trash2,
  UploadCloud,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { matchesSearch } from '@/lib/hangul';
import { buildSheetStoragePath, isPdfFile, stripFileExtension } from '@/lib/storage';
import type { TeamRole } from '@/types/supabase';
import UploadSheetModal from './UploadSheetModal';
import CreateSetlistFromSelectionModal from './CreateSetlistFromSelectionModal';
import SheetPreviewModal from './SheetPreviewModal';
import SheetThumbnail from './SheetThumbnail';

export interface SheetRow {
  id: string;
  title: string;
  composer: string | null;
  key: string | null;
  bpm: number | null;
  tags: string[];
  file_url: string | null;
  created_at: string;
}

type SortKey = 'title' | 'created_at';
type SortDirection = 'asc' | 'desc';

interface SheetsLibraryClientProps {
  teamId: string;
  role: TeamRole;
  initialSheets: SheetRow[];
}

export default function SheetsLibraryClient({ teamId, role, initialSheets }: SheetsLibraryClientProps) {
  const router = useRouter();
  const supabase = createClient();

  const [sheets, setSheets] = useState(initialSheets);
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('title');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showCreateSetlistModal, setShowCreateSetlistModal] = useState(false);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [bulkUploading, setBulkUploading] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [thumbnailUrls, setThumbnailUrls] = useState<Record<string, string>>({});
  const dragCounter = useRef(0);

  const canDelete = role === 'LEADER';

  const filteredSorted = useMemo(() => {
    const filtered = sheets.filter((sheet) => matchesSearch(sheet.title, query));
    const sorted = [...filtered].sort((a, b) =>
      sortKey === 'title'
        ? a.title.localeCompare(b.title, 'ko')
        : a.created_at.localeCompare(b.created_at)
    );
    if (sortDirection === 'desc') sorted.reverse();
    return sorted;
  }, [sheets, query, sortKey, sortDirection]);

  const selectedSheets = useMemo(
    () => filteredSorted.filter((sheet) => selectedIds.has(sheet.id)),
    [filteredSorted, selectedIds]
  );

  const allSelected = filteredSorted.length > 0 && selectedIds.size === filteredSorted.length;

  // 이미지 파일들의 썸네일용 signed URL을 한 번에 배치로 받아온다 (PDF는 아이콘만 표시).
  useEffect(() => {
    const imageSheets = sheets.filter((sheet) => sheet.file_url && !isPdfFile(sheet.file_url));
    if (imageSheets.length === 0) return;

    let cancelled = false;

    async function loadThumbnails() {
      const paths = imageSheets.map((sheet) => sheet.file_url as string);
      const { data } = await supabase.storage.from('sheets').createSignedUrls(paths, 60 * 60);

      if (cancelled || !data) return;

      setThumbnailUrls((prev) => {
        const next = { ...prev };
        imageSheets.forEach((sheet, i) => {
          const signedUrl = data[i]?.signedUrl;
          if (signedUrl) next[sheet.id] = signedUrl;
        });
        return next;
      });
    }

    loadThumbnails();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheets]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDirection('asc');
    }
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelectedIds((prev) => {
      if (prev.size === filteredSorted.length && filteredSorted.length > 0) {
        return new Set();
      }
      return new Set(filteredSorted.map((sheet) => sheet.id));
    });
  }

  async function handleDeleteSelected() {
    if (selectedIds.size === 0) return;
    if (!confirm(`선택한 악보 ${selectedIds.size}개를 삭제할까요?`)) return;

    setDeleting(true);
    setError(null);

    const ids = Array.from(selectedIds);
    const { error: deleteError } = await supabase.from('sheets').delete().in('id', ids);

    setDeleting(false);

    if (deleteError) {
      setError(deleteError.message);
      return;
    }

    setSheets((prev) => prev.filter((sheet) => !selectedIds.has(sheet.id)));
    setSelectedIds(new Set());
    router.refresh();
  }

  async function handleBulkUpload(files: File[]) {
    setBulkUploading({ done: 0, total: files.length });
    setError(null);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setBulkUploading(null);
      setError('로그인이 필요합니다.');
      return;
    }

    const uploaded: SheetRow[] = [];
    const failed: string[] = [];

    for (const file of files) {
      const path = buildSheetStoragePath(teamId, file.name);

      const { error: uploadError } = await supabase.storage.from('sheets').upload(path, file);
      if (uploadError) {
        failed.push(`${file.name}: ${uploadError.message}`);
        setBulkUploading((prev) => (prev ? { ...prev, done: prev.done + 1 } : prev));
        continue;
      }

      const { data: sheet, error: insertError } = await supabase
        .from('sheets')
        .insert({
          team_id: teamId,
          title: stripFileExtension(file.name),
          file_url: path,
          created_by: user.id,
        })
        .select('id, title, composer, key, bpm, tags, file_url, created_at')
        .single();

      if (insertError) {
        failed.push(`${file.name}: ${insertError.message}`);
      } else if (sheet) {
        uploaded.push(sheet);
      }

      setBulkUploading((prev) => (prev ? { ...prev, done: prev.done + 1 } : prev));
    }

    setSheets((prev) => [...uploaded, ...prev]);
    setBulkUploading(null);
    if (failed.length > 0) setError(failed.join(' / '));
    router.refresh();
  }

  function handleDragEnter(e: DragEvent<HTMLDivElement>) {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    dragCounter.current += 1;
    setIsDraggingOver(true);
  }

  function handleDragOver(e: DragEvent<HTMLDivElement>) {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
  }

  function handleDragLeave(e: DragEvent<HTMLDivElement>) {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    dragCounter.current = Math.max(0, dragCounter.current - 1);
    if (dragCounter.current === 0) setIsDraggingOver(false);
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    dragCounter.current = 0;
    setIsDraggingOver(false);

    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;

    // 드래그 앤 드롭은 파일 개수와 관계없이 모달 없이 파일명으로 바로 추가한다.
    void handleBulkUpload(files);
  }

  function renderSortIcon(key: SortKey) {
    if (sortKey !== key) return <ArrowUpDown size={14} className="text-gray-300" />;
    return sortDirection === 'asc' ? <ArrowUp size={14} /> : <ArrowDown size={14} />;
  }

  return (
    <div
      className="relative flex flex-col gap-4"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDraggingOver && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/5 border-2 border-dashed border-black rounded-lg pointer-events-none">
          <div className="bg-white rounded-lg shadow-lg px-6 py-4 flex items-center gap-3">
            <UploadCloud size={20} />
            <span className="text-sm font-medium">여기에 파일을 놓아 새 악보 추가</span>
          </div>
        </div>
      )}

      {bulkUploading && (
        <div className="flex items-center gap-2 bg-gray-100 border rounded-lg px-4 py-3 text-sm">
          <UploadCloud size={16} />
          업로드 중... ({bulkUploading.done}/{bulkUploading.total})
        </div>
      )}

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="제목 검색 (초성 검색 가능)"
            className="w-full border rounded pl-9 pr-3 py-2 text-sm"
          />
        </div>

        <button
          type="button"
          onClick={() => setShowUploadModal(true)}
          className="flex items-center gap-2 text-sm font-medium border rounded px-4 py-2 hover:bg-gray-50"
        >
          <Plus size={16} />새 악보 추가
        </button>
      </div>

      {selectedIds.size > 0 && (
        <div className="flex items-center justify-between gap-3 bg-gray-100 border rounded-lg px-4 py-3">
          <span className="text-sm font-medium">{selectedIds.size}개 선택됨</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowCreateSetlistModal(true)}
              className="flex items-center gap-1.5 text-sm font-medium border rounded px-3 py-1.5 hover:bg-white"
            >
              <CalendarPlus size={14} />이 곡들로 콘티 만들기
            </button>
            {canDelete && (
              <button
                type="button"
                onClick={handleDeleteSelected}
                disabled={deleting}
                className="flex items-center gap-1.5 text-sm font-medium border border-red-200 text-red-600 rounded px-3 py-1.5 hover:bg-red-50 disabled:opacity-50"
              >
                <Trash2 size={14} />
                {deleting ? '삭제 중...' : '선택 삭제'}
              </button>
            )}
          </div>
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="bg-white border rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-gray-50 text-left text-gray-500">
              <th className="w-10 px-4 py-3">
                <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} />
              </th>
              <th className="px-2 py-3">
                <button
                  type="button"
                  onClick={() => toggleSort('title')}
                  className="flex items-center gap-1 font-medium hover:text-gray-900"
                >
                  제목 {renderSortIcon('title')}
                </button>
              </th>
              <th className="px-2 py-3 font-medium">작곡가</th>
              <th className="px-2 py-3 font-medium">Key</th>
              <th className="px-2 py-3 font-medium">BPM</th>
              <th className="px-2 py-3">
                <button
                  type="button"
                  onClick={() => toggleSort('created_at')}
                  className="flex items-center gap-1 font-medium hover:text-gray-900"
                >
                  등록일 {renderSortIcon('created_at')}
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {filteredSorted.map((sheet, index) => (
              <tr
                key={sheet.id}
                onClick={() => setPreviewIndex(index)}
                className="border-b last:border-b-0 hover:bg-gray-50 cursor-pointer"
              >
                <td className="px-4 py-3 align-top" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={selectedIds.has(sheet.id)}
                    onChange={() => toggleSelect(sheet.id)}
                  />
                </td>
                <td className="px-2 py-3 align-top">
                  <div className="flex items-start gap-2">
                    <SheetThumbnail
                      title={sheet.title}
                      fileUrl={sheet.file_url}
                      signedUrl={thumbnailUrls[sheet.id]}
                    />
                    <div className="min-w-0">
                      <p className="font-medium truncate">{sheet.title}</p>
                      {sheet.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {sheet.tags.map((tag) => (
                            <span
                              key={tag}
                              className="text-[10px] text-gray-500 bg-gray-100 rounded-full px-2 py-0.5"
                            >
                              #{tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </td>
                <td className="px-2 py-3 align-top text-gray-600">{sheet.composer ?? '-'}</td>
                <td className="px-2 py-3 align-top text-gray-600">{sheet.key ?? '-'}</td>
                <td className="px-2 py-3 align-top text-gray-600">{sheet.bpm ?? '-'}</td>
                <td className="px-2 py-3 align-top text-gray-500">
                  {new Date(sheet.created_at).toLocaleDateString('ko-KR')}
                </td>
              </tr>
            ))}

            {filteredSorted.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-gray-400">
                  {sheets.length === 0 ? '등록된 악보가 없습니다.' : '검색 결과가 없습니다.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {showUploadModal && (
        <UploadSheetModal
          teamId={teamId}
          onClose={() => setShowUploadModal(false)}
          onUploaded={(sheet) => {
            setSheets((prev) => [sheet, ...prev]);
            setShowUploadModal(false);
            router.refresh();
          }}
        />
      )}

      {showCreateSetlistModal && (
        <CreateSetlistFromSelectionModal
          teamId={teamId}
          sheets={selectedSheets}
          onClose={() => setShowCreateSetlistModal(false)}
        />
      )}

      {previewIndex !== null && (
        <SheetPreviewModal
          sheets={filteredSorted}
          initialIndex={previewIndex}
          teamId={teamId}
          onClose={() => setPreviewIndex(null)}
        />
      )}
    </div>
  );
}
