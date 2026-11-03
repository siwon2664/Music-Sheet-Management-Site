'use client';

import { type DragEvent, memo, type MutableRefObject, startTransition, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  CalendarPlus,
  Download,
  MoreVertical,
  Pencil,
  Plus,
  Search,
  Trash2,
  UploadCloud,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { matchesSearch } from '@/lib/hangul';
import { keyFromTitle } from '@/lib/setlist';
import { isPdfFile, stripFileExtension } from '@/lib/storage';
import { isExemptFromSheetLimit, MAX_SHEETS_PER_TEAM, SHEET_LIMIT_MESSAGE } from '@/lib/limits';
import { getCachedSignedUrl, setCachedSignedUrl } from '@/lib/signedUrlCache';
import { SERVICE_TIME_ZONE } from '@/lib/koreaTime';
import { useEscapeKey } from '@/lib/useEscapeKey';
import { getSignedSheetUrls, removeSheetFiles } from '@/lib/sheetStorage';
import type { ExportSheetSource } from '@/lib/exportSheets';
import type { TeamRole } from '@/types/supabase';
import SheetThumbnail from './SheetThumbnail';

// 업로드·수정·내보내기는 pdf-lib까지 끌고 와서 크므로 쓸 때 불러온다.
const UploadSheetModal = dynamic(() => import('./UploadSheetModal'), { ssr: false });
const EditSheetModal = dynamic(() => import('./EditSheetModal'), { ssr: false });
const CreateSetlistFromSelectionModal = dynamic(() => import('./CreateSetlistFromSelectionModal'), { ssr: false });
const SheetPreviewModal = dynamic(() => import('./SheetPreviewModal'), { ssr: false });

const INITIAL_ROW_COUNT = 40;

export interface SheetRow {
  id: string;
  title: string;
  composer: string | null;
  key: string | null;
  bpm: number | null;
  tags: string[];
  file_url: string | null;
  thumbnail_url: string | null;
  created_at: string;
}

type SortKey = 'title' | 'created_at';
type SortDirection = 'asc' | 'desc';

interface SheetsLibraryClientProps {
  teamId: string;
  teamName: string;
  role: TeamRole;
  initialSheets: SheetRow[];
}

export default function SheetsLibraryClient({ teamId, teamName, role, initialSheets }: SheetsLibraryClientProps) {
  const router = useRouter();
  const supabase = createClient();

  const [sheets, setSheets] = useState(initialSheets);
  const [query, setQuery] = useState('');
  // 곡이 수백 개면 필터링과 렌더링이 타이핑을 막으므로 입력보다 늦게 따라오게 한다.
  const deferredQuery = useDeferredValue(query);
  const [sortKey, setSortKey] = useState<SortKey>('title');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showUploadModal, setShowUploadModal] = useState(false);
  // 편집 대상 — 상단 "편집하기" 버튼(체크박스 선택 기반)과 각 행의 ⋮ 메뉴("수정") 둘
  // 다 여기로 모아서 같은 EditSheetModal 인스턴스를 띄운다.
  const [editingSheet, setEditingSheet] = useState<SheetRow | null>(null);
  const [showCreateSetlistModal, setShowCreateSetlistModal] = useState(false);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [bulkUploading, setBulkUploading] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [thumbnailUrls, setThumbnailUrls] = useState<Record<string, string>>({});
  const dragCounter = useRef(0);

  const [showDownloadModal, setShowDownloadModal] = useState(false);
  const [downloadMode, setDownloadMode] = useState<'single' | 'separate' | null>(null);
  const [downloading, setDownloading] = useState<{ done: number; total: number } | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const rowActions = useRef<SheetRowActions>({
    preview: () => {},
    toggleSelect: () => {},
    edit: () => {},
    remove: () => {},
  });

  // 가장 자주 쓰는 미리보기는 첫 클릭부터 바로 열리도록 미리 받아 둔다.
  useEffect(() => {
    const timer = setTimeout(() => void import('./SheetPreviewModal'), 1500);
    return () => clearTimeout(timer);
  }, []);

  // 전체 행을 한 번에 그리면 페이지가 멈춘 듯 보이므로 첫 화면을 먼저 보여주고 나머지는 뒤에서 그린다.
  const [rowLimit, setRowLimit] = useState(INITIAL_ROW_COUNT);
  useEffect(() => {
    const timer = setTimeout(() => startTransition(() => setRowLimit(Infinity)));
    return () => clearTimeout(timer);
  }, []);

  useEscapeKey(() => closeDownloadModal(), showDownloadModal && !downloading);

  const canDelete = role === 'LEADER';
  const sheetLimitExempt = isExemptFromSheetLimit(teamName);
  const sheetLimitReached = !sheetLimitExempt && sheets.length >= MAX_SHEETS_PER_TEAM;

  const filteredSorted = useMemo(() => {
    const filtered = sheets.filter((sheet) => matchesSearch(sheet.title, deferredQuery));
    const sorted = [...filtered].sort((a, b) =>
      sortKey === 'title'
        ? a.title.localeCompare(b.title, 'ko')
        : a.created_at.localeCompare(b.created_at)
    );
    if (sortDirection === 'desc') sorted.reverse();
    return sorted;
  }, [sheets, deferredQuery, sortKey, sortDirection]);

  const selectedSheets = useMemo(
    () => filteredSorted.filter((sheet) => selectedIds.has(sheet.id)),
    [filteredSorted, selectedIds]
  );

  const allSelected = filteredSorted.length > 0 && selectedIds.size === filteredSorted.length;

  // 미리보기가 가능한 파일들의 썸네일용 signed URL을 받아온다 — 이미지 파일 전부와,
  // 업로드 시점에 첫 페이지 썸네일이 만들어진 PDF(thumbnail_url이 있는 경우)만 대상.
  // 썸네일이 없는 PDF(이 기능이 추가되기 전에 올렸거나 생성 실패)는 계속 아이콘만 표시한다.
  // 세션 내 캐시를 먼저 확인해 이미 발급받은 URL은 페이지를 다시 열어도 재요청하지 않는다.
  useEffect(() => {
    const imageSheets = sheets.filter(
      (sheet) => sheet.file_url && (!isPdfFile(sheet.file_url) || sheet.thumbnail_url)
    );
    if (imageSheets.length === 0) return;

    let cancelled = false;

    async function loadThumbnails() {
      const cached: Record<string, string> = {};
      const uncached: { sheetId: string; path: string }[] = [];

      for (const sheet of imageSheets) {
        const path = (sheet.thumbnail_url ?? sheet.file_url) as string;
        const hit = getCachedSignedUrl(path);
        if (hit) {
          cached[sheet.id] = hit;
        } else {
          uncached.push({ sheetId: sheet.id, path });
        }
      }

      if (Object.keys(cached).length > 0) {
        setThumbnailUrls((prev) => ({ ...prev, ...cached }));
      }

      if (uncached.length === 0) return;

      const urls = await getSignedSheetUrls(uncached.map((item) => item.path));

      if (cancelled) return;

      setThumbnailUrls((prev) => {
        const next = { ...prev };
        uncached.forEach((item, i) => {
          const signedUrl = urls[i];
          if (signedUrl) {
            next[item.sheetId] = signedUrl;
            setCachedSignedUrl(item.path, signedUrl);
          }
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

  // DB 행 삭제만으로는 Storage의 실제 파일(원본/썸네일)이 지워지지 않으므로
  // 함께 지운다. Storage 삭제가 실패해도(이미 지워졌거나 권한 문제) DB 삭제는
  // 이미 끝난 뒤라 조용히 넘어간다 — 남는 파일은 findOrphanedStorage 스크립트로
  // 나중에 정리할 수 있다.
  async function removeStorageFiles(sheetsToRemove: SheetRow[]) {
    const paths = sheetsToRemove.flatMap((sheet) =>
      [sheet.file_url, sheet.thumbnail_url].filter((p): p is string => !!p)
    );
    if (paths.length === 0) return;
    await removeSheetFiles(paths);
  }

  async function handleDeleteSelected() {
    if (selectedIds.size === 0) return;
    if (!confirm(`선택한 악보 ${selectedIds.size}개를 삭제할까요?`)) return;

    setDeleting(true);
    setError(null);

    const ids = Array.from(selectedIds);
    const sheetsToRemove = sheets.filter((sheet) => selectedIds.has(sheet.id));
    const { error: deleteError } = await supabase.from('sheets').delete().in('id', ids);

    setDeleting(false);

    if (deleteError) {
      setError(deleteError.message);
      return;
    }

    void removeStorageFiles(sheetsToRemove);

    setSheets((prev) => prev.filter((sheet) => !selectedIds.has(sheet.id)));
    setSelectedIds(new Set());
    router.refresh();
  }

  // 행 메뉴에서 악보 하나만 바로 삭제 — 체크박스 선택 상태와 무관하게 동작한다.
  async function handleDeleteSingle(sheet: SheetRow) {
    if (!confirm(`"${sheet.title}"을(를) 삭제할까요?`)) return;

    setDeleting(true);
    setError(null);

    const { error: deleteError } = await supabase.from('sheets').delete().eq('id', sheet.id);

    setDeleting(false);

    if (deleteError) {
      setError(deleteError.message);
      return;
    }

    void removeStorageFiles([sheet]);

    setSheets((prev) => prev.filter((s) => s.id !== sheet.id));
    setSelectedIds((prev) => {
      if (!prev.has(sheet.id)) return prev;
      const next = new Set(prev);
      next.delete(sheet.id);
      return next;
    });
    router.refresh();
  }

  function sanitizeFilename(name: string): string {
    return name.replace(/[\\/:*?"<>|]/g, '_').trim() || '악보';
  }

  function triggerDownload(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function openDownloadModal() {
    setDownloadError(null);
    setDownloadMode(selectedSheets.length > 1 ? null : 'single');
    setShowDownloadModal(true);
  }

  function closeDownloadModal() {
    setShowDownloadModal(false);
    setDownloadMode(null);
    setDownloadError(null);
  }

  async function handleDownload(includeMarkup: boolean) {
    const sources: ExportSheetSource[] = selectedSheets
      .filter((sheet): sheet is typeof sheet & { file_url: string } => !!sheet.file_url)
      .map((sheet) => ({ id: sheet.id, title: sheet.title, fileUrl: sheet.file_url }));

    if (sources.length === 0) {
      setDownloadError('다운로드할 악보 파일이 없습니다.');
      return;
    }

    setDownloadError(null);
    setDownloading({ done: 0, total: sources.length });

    try {
      const { exportSheetsAsMergedPdf, exportSheetsAsSeparatePdfs } = await import('@/lib/exportSheets');
      if (downloadMode === 'separate' && sources.length > 1) {
        const { files, skipped } = await exportSheetsAsSeparatePdfs(
          supabase,
          sources,
          { includeMarkup },
          (done, total) => setDownloading({ done, total })
        );

        for (let i = 0; i < files.length; i++) {
          triggerDownload(files[i].blob, `${sanitizeFilename(files[i].title)}.pdf`);
          // 브라우저가 여러 다운로드를 한꺼번에 요청받으면 막는 경우가 있어 살짝 간격을 둔다.
          if (i < files.length - 1) await new Promise((resolve) => setTimeout(resolve, 300));
        }

        if (skipped.length > 0) {
          setDownloadError(`다음 악보는 포함하지 못했습니다: ${skipped.join(', ')}`);
        } else {
          closeDownloadModal();
        }
      } else {
        const { blob, skipped } = await exportSheetsAsMergedPdf(
          supabase,
          sources,
          { includeMarkup },
          (done, total) => setDownloading({ done, total })
        );

        const filename = sources.length === 1 ? sanitizeFilename(sources[0].title) : `악보 ${sources.length}곡`;
        triggerDownload(blob, `${filename}.pdf`);

        if (skipped.length > 0) {
          setDownloadError(`다음 악보는 포함하지 못했습니다: ${skipped.join(', ')}`);
        } else {
          closeDownloadModal();
        }
      }
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : '다운로드에 실패했습니다.');
    } finally {
      setDownloading(null);
    }
  }

  async function handleBulkUpload(files: File[]) {
    const available = sheetLimitExempt ? files.length : Math.max(0, MAX_SHEETS_PER_TEAM - sheets.length);
    const filesToUpload = files.slice(0, available);
    const skippedFiles = files.slice(available);

    if (filesToUpload.length === 0) {
      setError(SHEET_LIMIT_MESSAGE);
      return;
    }

    setBulkUploading({ done: 0, total: filesToUpload.length });
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
    const failed: string[] = skippedFiles.map((file) => `${file.name}: ${SHEET_LIMIT_MESSAGE}`);

    const { uploadSheetFile } = await import('@/lib/sheetUpload');

    for (const file of filesToUpload) {
      const { data: uploadedFile, error: uploadError } = await uploadSheetFile(teamId, file);

      if (uploadError || !uploadedFile) {
        failed.push(`${file.name}: ${uploadError ?? '업로드에 실패했습니다.'}`);
        setBulkUploading((prev) => (prev ? { ...prev, done: prev.done + 1 } : prev));
        continue;
      }

      const { data: sheet, error: insertError } = await supabase
        .from('sheets')
        .insert({
          team_id: teamId,
          title: stripFileExtension(file.name),
          file_url: uploadedFile.filePath,
          thumbnail_url: uploadedFile.thumbnailPath,
          created_by: user.id,
        })
        .select('id, title, composer, key, bpm, tags, file_url, thumbnail_url, created_at')
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
    if (sortKey !== key) return <ArrowUpDown size={14} className="text-muted" />;
    return sortDirection === 'asc' ? <ArrowUp size={14} /> : <ArrowDown size={14} />;
  }


  rowActions.current = {
    preview: setPreviewIndex,
    toggleSelect,
    edit: setEditingSheet,
    remove: handleDeleteSingle,
  };

  return (
    <div
      className="relative flex flex-col gap-4"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDraggingOver && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-accent/10 border-2 border-dashed border-accent rounded-lg pointer-events-none">
          <div className="bg-surface text-foreground rounded-lg shadow-lg px-6 py-4 flex items-center gap-3">
            <UploadCloud size={20} />
            <span className="text-sm font-medium">여기에 파일을 놓아 새 악보 추가</span>
          </div>
        </div>
      )}

      {bulkUploading && (
        <div className="flex items-center gap-2 bg-surface-hover border border-border rounded-lg px-4 py-3 text-sm text-foreground">
          <UploadCloud size={16} />
          업로드 중... ({bulkUploading.done}/{bulkUploading.total})
        </div>
      )}

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="제목 검색 (초성 검색 가능)"
            className="w-full bg-surface text-foreground border border-border rounded pl-9 pr-3 py-2 text-sm"
          />
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setEditingSheet(selectedSheets[0] ?? null)}
            disabled={selectedSheets.length !== 1}
            title={selectedSheets.length !== 1 ? '악보 하나를 선택하면 정보를 수정할 수 있습니다.' : undefined}
            className="flex items-center gap-2 text-sm font-medium border border-border rounded px-4 py-2 hover:bg-surface-hover disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Pencil size={16} />
            편집하기
          </button>
          <button
            type="button"
            onClick={() => setShowUploadModal(true)}
            disabled={sheetLimitReached}
            title={sheetLimitReached ? SHEET_LIMIT_MESSAGE : undefined}
            className="flex items-center gap-2 text-sm font-medium border border-border rounded px-4 py-2 hover:bg-surface-hover disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Plus size={16} />
            새 악보 추가{!sheetLimitExempt && ` (${sheets.length}/${MAX_SHEETS_PER_TEAM})`}
          </button>
        </div>
      </div>

      {selectedIds.size > 0 && (
        <div className="flex items-center justify-between gap-3 bg-surface-hover border border-border rounded-lg px-4 py-3">
          <span className="text-sm font-medium">{selectedIds.size}개 선택됨</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowCreateSetlistModal(true)}
              className="flex items-center gap-1.5 text-sm font-medium border border-border rounded px-3 py-1.5 hover:bg-surface"
            >
              <CalendarPlus size={14} />이 곡들로 콘티 만들기
            </button>
            <button
              type="button"
              onClick={openDownloadModal}
              className="flex items-center gap-1.5 text-sm font-medium border border-border rounded px-3 py-1.5 hover:bg-surface"
            >
              <Download size={14} />
              다운로드
            </button>
            {canDelete && (
              <button
                type="button"
                onClick={handleDeleteSelected}
                disabled={deleting}
                className="flex items-center gap-1.5 text-sm font-medium border border-red-300 dark:border-red-500/40 text-red-600 dark:text-red-400 rounded px-3 py-1.5 hover:bg-red-50 dark:hover:bg-red-500/10 disabled:opacity-50"
              >
                <Trash2 size={14} />
                {deleting ? '삭제 중...' : '선택 삭제'}
              </button>
            )}
          </div>
        </div>
      )}

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="bg-surface border border-border rounded-lg">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-hover text-left text-muted">
              <th className="w-10 p-0">
                <label className="flex items-center justify-center w-11 h-11 cursor-pointer">
                  <input
                    type="checkbox"
                    aria-label="전체 선택"
                    className="w-4 h-4"
                    checked={allSelected}
                    onChange={toggleSelectAll}
                  />
                </label>
              </th>
              <th className="px-2 py-3">
                <button
                  type="button"
                  onClick={() => toggleSort('title')}
                  className="flex items-center gap-1 font-medium hover:text-foreground"
                >
                  제목 {renderSortIcon('title')}
                </button>
              </th>
              <th className="hidden md:table-cell px-2 py-3 font-medium">작곡가</th>
              <th className="hidden md:table-cell px-2 py-3 font-medium">Key</th>
              <th className="hidden md:table-cell px-2 py-3 font-medium">BPM</th>
              <th className="hidden md:table-cell px-2 py-3">
                <button
                  type="button"
                  onClick={() => toggleSort('created_at')}
                  className="flex items-center gap-1 font-medium hover:text-foreground"
                >
                  등록일 {renderSortIcon('created_at')}
                </button>
              </th>
              <th className="w-10 px-2 py-3" aria-label="관리" />
            </tr>
          </thead>
          <tbody>
            {filteredSorted.slice(0, rowLimit).map((sheet, index) => (
              <SheetTableRow
                key={sheet.id}
                sheet={sheet}
                index={index}
                selected={selectedIds.has(sheet.id)}
                signedUrl={thumbnailUrls[sheet.id]}
                canDelete={canDelete}
                actions={rowActions}
              />
            ))}

            {filteredSorted.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-muted">
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
          currentCount={sheets.length}
          limitExempt={sheetLimitExempt}
          onClose={() => setShowUploadModal(false)}
          onUploaded={(sheet) => {
            setSheets((prev) => [sheet, ...prev]);
            setShowUploadModal(false);
            router.refresh();
          }}
        />
      )}

      {editingSheet && (
        <EditSheetModal
          sheet={editingSheet}
          teamId={teamId}
          onClose={() => setEditingSheet(null)}
          onUpdated={(updated) => {
            setSheets((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
            setEditingSheet(null);
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

      {showDownloadModal && (
        <div role="dialog" aria-modal="true" aria-label="악보 다운로드" className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-surface text-foreground rounded-lg shadow-lg w-full max-w-sm p-6">
            {downloadMode === null ? (
              <>
                <h2 className="text-lg font-semibold mb-2">다운로드 방식 선택</h2>
                <p className="text-sm text-muted mb-4">
                  선택한 악보 {selectedSheets.length}개를 어떻게 받을까요?
                </p>
                <div className="flex flex-col gap-2">
                  <button
                    type="button"
                    onClick={() => setDownloadMode('single')}
                    className="bg-accent text-accent-foreground rounded px-4 py-2 text-sm font-medium hover:bg-accent-hover"
                  >
                    하나의 파일로 합쳐서 받기
                  </button>
                  <button
                    type="button"
                    onClick={() => setDownloadMode('separate')}
                    className="border border-border rounded px-4 py-2 text-sm font-medium hover:bg-surface-hover"
                  >
                    개별 파일로 각각 받기
                  </button>
                  <button
                    type="button"
                    onClick={closeDownloadModal}
                    className="text-sm text-muted hover:text-foreground mt-1"
                  >
                    취소
                  </button>
                </div>
              </>
            ) : (
              <>
                <h2 className="text-lg font-semibold mb-2">필기 포함 여부</h2>
                <p className="text-sm text-muted mb-4">
                  내가 그려둔 필기(마킹)를 악보에 포함해서 받을까요? 여백은 화면에 보이는 것처럼 잘라낸
                  크기로 저장됩니다.
                </p>

                {downloadError && <p className="text-sm text-red-600 dark:text-red-400 mb-4">{downloadError}</p>}

                <div className="flex flex-col gap-2">
                  <button
                    type="button"
                    onClick={() => handleDownload(true)}
                    disabled={!!downloading}
                    className="bg-accent text-accent-foreground rounded px-4 py-2 text-sm font-medium hover:bg-accent-hover disabled:opacity-50"
                  >
                    {downloading ? `만드는 중... (${downloading.done}/${downloading.total})` : '필기 포함해서 다운로드'}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDownload(false)}
                    disabled={!!downloading}
                    className="border border-border rounded px-4 py-2 text-sm font-medium hover:bg-surface-hover disabled:opacity-50"
                  >
                    {downloading ? '만드는 중...' : '악보만 다운로드'}
                  </button>
                  <button
                    type="button"
                    onClick={() => (selectedSheets.length > 1 ? setDownloadMode(null) : closeDownloadModal())}
                    disabled={!!downloading}
                    className="text-sm text-muted hover:text-foreground mt-1 disabled:opacity-50"
                  >
                    {selectedSheets.length > 1 ? '이전' : '취소'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

interface SheetRowMenuProps {
  onEdit: () => void;
  // 없으면(팀원 권한 등으로 삭제 불가) 삭제 항목 자체를 안 보여준다.
  onDelete?: () => void;
}

interface SheetRowActions {
  preview: (index: number) => void;
  toggleSelect: (id: string) => void;
  edit: (sheet: SheetRow) => void;
  remove: (sheet: SheetRow) => void;
}

interface SheetTableRowProps {
  sheet: SheetRow;
  index: number;
  selected: boolean;
  signedUrl?: string;
  canDelete: boolean;
  actions: MutableRefObject<SheetRowActions>;
}

// memo: 체크박스 하나를 눌러도 수백 개 행을 전부 다시 그리지 않게 한다. 핸들러는 ref로
// 받아서 부모가 다시 렌더링돼도 이 행의 props가 바뀌지 않는다.
const SheetTableRow = memo(function SheetTableRow({
  sheet,
  index,
  selected,
  signedUrl,
  canDelete,
  actions,
}: SheetTableRowProps) {
  const sheetKey = sheet.key ?? keyFromTitle(sheet.title);

  return (
    <tr
      onClick={() => actions.current.preview(index)}
      className="border-b border-border last:border-b-0 hover:bg-surface-hover cursor-pointer"
    >
      {/* 작은 체크박스를 정확히 못 눌러도 되게 칸 전체를 라벨로 만든다. */}
      <td className="p-0 align-top" onClick={(e) => e.stopPropagation()}>
        <label className="flex items-center justify-center w-11 h-14 cursor-pointer">
          <input
            type="checkbox"
            aria-label={`${sheet.title} 선택`}
            className="w-4 h-4"
            checked={selected}
            onChange={() => actions.current.toggleSelect(sheet.id)}
          />
        </label>
      </td>
      <td className="px-2 py-2 align-top">
        <div className="flex items-start gap-2">
          <SheetThumbnail
            title={sheet.title}
            fileUrl={sheet.file_url}
            thumbnailUrl={sheet.thumbnail_url}
            signedUrl={signedUrl}
          />
          <div className="min-w-0">
            <p className="font-medium [overflow-wrap:anywhere]">{sheet.title}</p>
            {/* 모바일에서는 칸을 숨기는 대신 제목 아래에 보여준다. */}
            {(sheetKey || sheet.bpm) && (
              <p className="md:hidden text-xs text-muted mt-0.5">
                {[sheetKey, sheet.bpm ? `${sheet.bpm} BPM` : null].filter(Boolean).join(' · ')}
              </p>
            )}
            {sheet.tags.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1">
                {sheet.tags.map((tag) => (
                  <span key={tag} className="text-[10px] text-muted bg-surface-hover rounded-full px-2 py-0.5">
                    #{tag}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </td>
      <td className="hidden md:table-cell px-2 py-3 align-top text-muted">{sheet.composer ?? '-'}</td>
      <td className="hidden md:table-cell px-2 py-3 align-top text-muted">{sheetKey ?? '-'}</td>
      <td className="hidden md:table-cell px-2 py-3 align-top text-muted">{sheet.bpm ?? '-'}</td>
      <td className="hidden md:table-cell px-2 py-3 align-top text-muted whitespace-nowrap">
        {new Date(sheet.created_at).toLocaleDateString('ko-KR', { timeZone: SERVICE_TIME_ZONE })}
      </td>
      <td className="px-1 py-2 align-top text-right" onClick={(e) => e.stopPropagation()}>
        <SheetRowMenu
          onEdit={() => actions.current.edit(sheet)}
          onDelete={canDelete ? () => actions.current.remove(sheet) : undefined}
        />
      </td>
    </tr>
  );
});

// 각 행 끝의 ⋮ 버튼 — 체크박스로 선택하지 않아도 그 행 하나만 바로 수정/삭제할 수 있게 한다.
function SheetRowMenu({ onEdit, onDelete }: SheetRowMenuProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [open]);

  return (
    <div ref={containerRef} className="relative inline-block text-left">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex items-center justify-center w-10 h-10 rounded text-muted hover:text-foreground hover:bg-surface-hover"
        aria-label="더보기"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <MoreVertical size={16} />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-1 z-30 w-32 bg-surface border border-border rounded-lg shadow-lg py-1"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onEdit();
            }}
            className="flex items-center gap-2 w-full text-left px-3 py-2 text-sm hover:bg-surface-hover"
          >
            <Pencil size={14} />
            수정
          </button>
          {onDelete && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onDelete();
              }}
              className="flex items-center gap-2 w-full text-left px-3 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10"
            >
              <Trash2 size={14} />
              삭제
            </button>
          )}
        </div>
      )}
    </div>
  );
}
