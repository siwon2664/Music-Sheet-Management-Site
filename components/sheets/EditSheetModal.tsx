'use client';

import { useEffect, useState, type DragEvent as ReactDragEvent, type FormEvent } from 'react';
import { UploadCloud, X } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { uploadSheetFile } from '@/lib/sheetUpload';
import { isAllowedSheetFile, SHEET_FILE_ACCEPT, SHEET_FILE_TYPE_HINT } from '@/lib/fileTypes';
import { composePagesIntoFile, expandFileToPages, revokePagePreview, type PendingPage } from '@/lib/pageCompose';
import PageThumbStrip from './PageThumbStrip';
import type { SheetRow } from './SheetsLibraryClient';

interface EditSheetModalProps {
  sheet: SheetRow;
  teamId: string;
  onClose: () => void;
  onUpdated: (sheet: SheetRow) => void;
}

// 저장돼 있는 file_url의 확장자로부터 다운로드한 Blob에 붙여줄 MIME 타입을 추정한다.
// download()가 돌려주는 Blob의 type은 스토리지 설정에 따라 비어있을 수 있어서,
// expandFileToPages가 PDF/이미지를 구분하는 데 쓰는 타입을 직접 채워줘야 한다.
function guessMimeType(fileUrl: string): string {
  const ext = fileUrl.toLowerCase().split('.').pop() ?? '';
  if (ext === 'pdf') return 'application/pdf';
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  return 'image/jpeg';
}

export default function EditSheetModal({ sheet, teamId, onClose, onUpdated }: EditSheetModalProps) {
  const supabase = createClient();

  const [title, setTitle] = useState(sheet.title);
  const [composer, setComposer] = useState(sheet.composer ?? '');
  const [key, setKey] = useState(sheet.key ?? '');
  const [dropActive, setDropActive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 낱장 목록 — 기존 파일을 페이지 단위로 펼친 뒤, 새 악보 추가 화면과 같은
  // 방식으로 순서를 바꾸거나 특정 페이지만 뺄 수 있게 한다. 사용자가 실제로
  // 손댄 적이 없으면(pagesDirty === false) 저장 시 파일을 건드리지 않고
  // 기존 file_url/thumbnail_url을 그대로 둔다 — 불러오기가 실패했다고 해서
  // 파일이 삭제되는 일이 없도록 하기 위함이다.
  const [pages, setPages] = useState<PendingPage[]>([]);
  const [pagesLoading, setPagesLoading] = useState(true);
  const [pagesDirty, setPagesDirty] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [expanding, setExpanding] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadExistingPages() {
      if (!sheet.file_url) {
        setPagesLoading(false);
        return;
      }

      setPagesLoading(true);
      setLoadError(false);
      try {
        const { data, error: downloadError } = await supabase.storage.from('sheets').download(sheet.file_url);
        if (downloadError || !data) throw downloadError ?? new Error('download failed');

        const fileName = sheet.file_url.split('/').pop() || 'sheet';
        const existingFile = new File([data], fileName, { type: guessMimeType(sheet.file_url) });
        const expanded = await expandFileToPages(existingFile);
        if (!cancelled) setPages(expanded);
      } catch {
        if (!cancelled) setLoadError(true);
      } finally {
        if (!cancelled) setPagesLoading(false);
      }
    }

    loadExistingPages();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function addFiles(files: File[]) {
    // 기존 파일의 페이지를 아직 불러오는 중이면(비동기 다운로드 진행 중) 그 결과가
    // 나중에 pages를 통째로 덮어써버려 방금 추가한 페이지가 사라질 수 있으므로,
    // 로딩이 끝날 때까지는 새 페이지 추가를 받지 않는다.
    if (pagesLoading) return;

    const valid = files.filter((f) => isAllowedSheetFile(f));
    if (valid.length < files.length) setError(SHEET_FILE_TYPE_HINT);
    else setError(null);
    if (valid.length === 0) return;

    setExpanding(true);
    try {
      const expanded = await Promise.all(valid.map(expandFileToPages));
      setPages((prev) => [...prev, ...expanded.flat()]);
      setPagesDirty(true);
    } catch {
      setError('파일을 불러오지 못했습니다.');
    } finally {
      setExpanding(false);
    }
  }

  function removePage(id: string) {
    setPages((prev) => {
      const target = prev.find((p) => p.id === id);
      if (target) revokePagePreview(target);
      return prev.filter((p) => p.id !== id);
    });
    setPagesDirty(true);
  }

  function removeAllPages() {
    setPages((prev) => {
      prev.forEach(revokePagePreview);
      return [];
    });
    setPagesDirty(true);
  }

  function handleReorder(next: PendingPage[]) {
    setPages(next);
    setPagesDirty(true);
  }

  function handleDropZoneDrop(e: ReactDragEvent<HTMLLabelElement>) {
    e.preventDefault();
    setDropActive(false);
    const dropped = Array.from(e.dataTransfer.files ?? []);
    if (dropped.length > 0) addFiles(dropped);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    let fileFields: { file_url: string | null; thumbnail_url: string | null } | null = null;

    // 페이지를 하나라도 건드렸을 때만 파일을 다시 합쳐서 올린다 — 손대지
    // 않았다면(로딩 실패로 pages가 비어 있는 경우 포함) 기존 파일은 그대로 둔다.
    if (pagesDirty) {
      if (pages.length === 0) {
        fileFields = { file_url: null, thumbnail_url: null };
      } else {
        let composedFile: File;
        try {
          composedFile = await composePagesIntoFile(pages);
        } catch {
          setLoading(false);
          setError('페이지를 합치지 못했습니다.');
          return;
        }

        const { data: uploadedFile, error: uploadError } = await uploadSheetFile(supabase, teamId, composedFile);
        if (uploadError || !uploadedFile) {
          setLoading(false);
          setError(uploadError ?? '파일을 업로드하지 못했습니다.');
          return;
        }
        fileFields = { file_url: uploadedFile.filePath, thumbnail_url: uploadedFile.thumbnailPath };
      }
    }

    const { data: updated, error: updateError } = await supabase
      .from('sheets')
      .update({
        title,
        composer: composer || null,
        key: key || null,
        ...fileFields,
      })
      .eq('id', sheet.id)
      .select('id, title, composer, key, bpm, tags, file_url, thumbnail_url, created_at')
      .single();

    setLoading(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    onUpdated(updated);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-surface text-foreground rounded-lg shadow-lg w-full max-w-sm p-6 relative">
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 text-muted hover:text-foreground"
          aria-label="닫기"
        >
          <X size={18} />
        </button>

        <h2 className="text-lg font-semibold mb-4">악보 정보 수정</h2>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm">
            제목
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="border border-border bg-surface rounded px-3 py-2"
              autoFocus
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            작곡가 (선택)
            <input
              type="text"
              value={composer}
              onChange={(e) => setComposer(e.target.value)}
              className="border border-border bg-surface rounded px-3 py-2"
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-sm">
              Key (선택)
              <input
                type="text"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="예: G"
                className="border border-border bg-surface rounded px-3 py-2"
              />
            </label>
            {sheet.bpm && (
              <div className="flex flex-col gap-1 text-sm">
                <span>BPM</span>
                <p className="px-3 py-2 text-muted">{sheet.bpm}</p>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-1 text-sm">
            악보 파일 (PDF/PNG/JPG/WEBP)
            <label
              onDragOver={(e) => {
                e.preventDefault();
                if (!pagesLoading) setDropActive(true);
              }}
              onDragLeave={() => setDropActive(false)}
              onDrop={handleDropZoneDrop}
              className={`border border-dashed border-border rounded px-3 py-4 flex flex-col items-center gap-2 text-muted ${
                pagesLoading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
              } ${dropActive ? 'border-accent bg-surface-hover' : ''}`}
            >
              <UploadCloud size={20} />
              <span className="text-xs text-center">
                {pagesLoading ? (
                  '기존 파일을 불러오는 중이에요...'
                ) : (
                  <>
                    끌어다 놓거나 클릭해서 페이지를 추가하세요
                    <br />
                    기존 페이지 뒤에 추가됩니다 (PDF 여러 페이지 가능)
                  </>
                )}
              </span>
              <input
                type="file"
                multiple
                accept={SHEET_FILE_ACCEPT}
                disabled={pagesLoading}
                onChange={(e) => {
                  const selected = Array.from(e.target.files ?? []);
                  e.target.value = '';
                  if (selected.length > 0) addFiles(selected);
                }}
                className="hidden"
              />
            </label>

            {pagesLoading && <p className="text-xs text-muted">기존 파일을 불러오는 중...</p>}
            {expanding && <p className="text-xs text-muted">페이지를 불러오는 중...</p>}

            {loadError && !pagesLoading && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                기존 파일의 페이지를 불러오지 못했습니다. 그대로 두면 기존 파일이 유지되고, 새 파일을 추가하면
                기존 파일은 새로 추가한 페이지로 교체됩니다.
              </p>
            )}

            {!pagesLoading && pages.length > 0 && (
              <>
                <div className="flex items-center justify-between mt-1">
                  <p className="text-xs text-muted">
                    {pages.length}장{pagesDirty ? ' · 변경됨' : ''} — 손잡이로 순서를 바꾸거나 X로 제외할 수 있어요
                  </p>
                  <button
                    type="button"
                    onClick={removeAllPages}
                    className="text-xs text-red-600 dark:text-red-400 hover:underline shrink-0 ml-2"
                  >
                    전체 삭제
                  </button>
                </div>
                <PageThumbStrip pages={pages} onReorder={handleReorder} onRemove={removePage} />
              </>
            )}

            {!pagesLoading && !loadError && pages.length === 0 && (
              <p className="text-xs text-muted mt-1">
                {pagesDirty ? '저장하면 파일이 삭제됩니다.' : '등록된 파일이 없습니다.'}
              </p>
            )}
          </div>

          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

          <div className="flex gap-2 justify-end mt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded px-4 py-2 text-sm border border-border hover:bg-surface-hover"
            >
              취소
            </button>
            <button
              type="submit"
              disabled={loading}
              className="bg-accent text-accent-foreground rounded px-4 py-2 text-sm hover:bg-accent-hover disabled:opacity-50"
            >
              {loading ? '저장 중...' : '저장하기'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
