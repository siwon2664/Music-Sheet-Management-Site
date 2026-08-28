'use client';

import { useEffect, useRef, useState, type DragEvent as ReactDragEvent, type FormEvent } from 'react';
import { UploadCloud, X } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { uploadSheetFile } from '@/lib/sheetUpload';
import { isAllowedSheetFile, SHEET_FILE_ACCEPT, SHEET_FILE_TYPE_HINT } from '@/lib/fileTypes';
import { isPdfFile as isPdfFileUrl } from '@/lib/storage';
import { createPdfThumbnailImage } from '@/lib/pageCompose';
import type { SheetRow } from './SheetsLibraryClient';

interface EditSheetModalProps {
  sheet: SheetRow;
  teamId: string;
  onClose: () => void;
  onUpdated: (sheet: SheetRow) => void;
}

function isPdfFile(file: File): boolean {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
}

export default function EditSheetModal({ sheet, teamId, onClose, onUpdated }: EditSheetModalProps) {
  const supabase = createClient();

  const [title, setTitle] = useState(sheet.title);
  const [composer, setComposer] = useState(sheet.composer ?? '');
  const [key, setKey] = useState(sheet.key ?? '');
  const [file, setFile] = useState<File | null>(null);
  // X를 눌러 기존 파일을 삭제하기로 표시한 상태 — 저장을 눌러야 실제로 반영되고,
  // 그 전까지는 X를 다시 눌러 취소(원래 파일로 복구)할 수 있다.
  const [removeExisting, setRemoveExisting] = useState(false);
  const [dropActive, setDropActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 지금 등록되어 있는 파일의 미리보기 — 파일을 새로 고르지 않았을 때 "기존 파일이
  // 이거다"를 보여준다. PDF인데 아직 썸네일이 없는 경우(백필 전)엔 signed url을
  // 받을 대상이 없으니 그대로 두고, 렌더링에서 PDF 배지로 대체한다.
  const [existingPreviewUrl, setExistingPreviewUrl] = useState<string | null>(null);

  // 새로 고른 파일의 미리보기 — 이미지면 바로, PDF면 첫 페이지를 렌더링해서 보여준다.
  const [newPreviewUrl, setNewPreviewUrl] = useState<string | null>(null);
  const [newPreviewLoading, setNewPreviewLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadExistingPreview() {
      if (!sheet.file_url) return;
      const previewPath = sheet.thumbnail_url ?? (!isPdfFileUrl(sheet.file_url) ? sheet.file_url : null);
      if (!previewPath) return;

      const { data } = await supabase.storage.from('sheets').createSignedUrl(previewPath, 60 * 60);
      if (!cancelled && data?.signedUrl) setExistingPreviewUrl(data.signedUrl);
    }

    loadExistingPreview();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!file) {
      setNewPreviewUrl(null);
      return;
    }

    let cancelled = false;
    let objectUrl: string | null = null;
    setNewPreviewLoading(true);

    async function buildPreview() {
      if (isPdfFile(file!)) {
        const thumb = await createPdfThumbnailImage(file!);
        if (thumb) objectUrl = URL.createObjectURL(thumb);
      } else {
        objectUrl = URL.createObjectURL(file!);
      }
      if (!cancelled) {
        setNewPreviewUrl(objectUrl);
        setNewPreviewLoading(false);
      }
    }

    buildPreview();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [file]);

  function selectFile(selected: File | null) {
    if (selected && !isAllowedSheetFile(selected)) {
      setError(SHEET_FILE_TYPE_HINT);
      setFile(null);
      return;
    }
    setError(null);
    setFile(selected);
    // 새 파일을 고르면(또는 선택을 취소하면) 삭제 표시는 의미가 없어지므로 함께 되돌린다.
    setRemoveExisting(false);
  }

  function handleDropZoneDrop(e: ReactDragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDropActive(false);
    const dropped = e.dataTransfer.files?.[0] ?? null;
    if (dropped) selectFile(dropped);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    let fileFields: { file_url: string | null; thumbnail_url: string | null } | null = null;

    if (file) {
      if (!isAllowedSheetFile(file)) {
        setLoading(false);
        setError(SHEET_FILE_TYPE_HINT);
        return;
      }

      const { data: uploadedFile, error: uploadError } = await uploadSheetFile(supabase, teamId, file);
      if (uploadError || !uploadedFile) {
        setLoading(false);
        setError(uploadError ?? '파일을 업로드하지 못했습니다.');
        return;
      }
      fileFields = { file_url: uploadedFile.filePath, thumbnail_url: uploadedFile.thumbnailPath };
    } else if (removeExisting) {
      fileFields = { file_url: null, thumbnail_url: null };
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
            파일 교체 (선택, PDF/PNG/JPG/WEBP)
            <div
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDropActive(true);
              }}
              onDragLeave={() => setDropActive(false)}
              onDrop={handleDropZoneDrop}
              className={`border border-dashed border-border rounded px-3 py-4 flex flex-col items-center gap-2 text-muted cursor-pointer ${
                dropActive ? 'border-accent bg-surface-hover' : ''
              }`}
            >
              <div className="relative shrink-0 w-16 h-24 rounded overflow-hidden border border-border bg-surface-hover flex items-center justify-center">
                {file ? (
                  newPreviewLoading ? (
                    <span className="text-[10px] text-muted px-1 text-center">미리보기 생성 중...</span>
                  ) : newPreviewUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={newPreviewUrl} alt="" className="w-full h-full object-contain" />
                  ) : (
                    <span className="text-red-500 dark:text-red-400 text-[10px] font-semibold">PDF</span>
                  )
                ) : removeExisting ? (
                  <span className="text-[10px] text-muted px-1 text-center">삭제 예정</span>
                ) : existingPreviewUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={existingPreviewUrl} alt="" className="w-full h-full object-contain" />
                ) : sheet.file_url && isPdfFileUrl(sheet.file_url) ? (
                  <span className="text-red-500 dark:text-red-400 text-[10px] font-semibold">PDF</span>
                ) : (
                  <UploadCloud size={20} />
                )}

                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (file || removeExisting) {
                      // 새 파일 선택 취소, 또는 삭제 예정 취소 — 둘 다 "원래 파일로 복구".
                      setFile(null);
                      setRemoveExisting(false);
                    } else if (sheet.file_url) {
                      setRemoveExisting(true);
                    } else {
                      fileInputRef.current?.click();
                    }
                  }}
                  className="absolute top-0.5 right-0.5 flex items-center justify-center w-4 h-4 rounded-full bg-black/70 text-white hover:bg-black"
                  aria-label={file || removeExisting ? '취소하고 기존 파일 유지' : '파일 삭제'}
                >
                  <X size={10} />
                </button>
              </div>

              <span className="text-xs text-center">
                {file
                  ? file.name
                  : removeExisting
                    ? '저장하면 파일이 삭제됩니다'
                    : '끌어다 놓거나 클릭해서 선택하세요'}
                {!file && !removeExisting && (
                  <>
                    <br />
                    선택하지 않으면 기존 파일이 유지됩니다.
                  </>
                )}
              </span>

              <input
                ref={fileInputRef}
                type="file"
                accept={SHEET_FILE_ACCEPT}
                onChange={(e) => {
                  const selected = e.target.files?.[0] ?? null;
                  e.target.value = '';
                  if (selected) selectFile(selected);
                }}
                className="hidden"
              />
            </div>
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
