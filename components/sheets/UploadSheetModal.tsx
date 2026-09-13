'use client';

import { useState, type DragEvent as ReactDragEvent, type FormEvent } from 'react';
import { Sparkles, UploadCloud, X } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { uploadSheetFile } from '@/lib/sheetUpload';
import { isAllowedSheetFile, SHEET_FILE_ACCEPT, SHEET_FILE_TYPE_HINT } from '@/lib/fileTypes';
import { MAX_SHEETS_PER_TEAM, SHEET_LIMIT_MESSAGE } from '@/lib/limits';
import { composePagesIntoFile, expandFileToPages, revokePagePreview, type PendingPage } from '@/lib/pageCompose';
import { recognizeSheet } from '@/lib/sheetRecognition';
import PageThumbStrip from './PageThumbStrip';
import type { SheetRow } from './SheetsLibraryClient';

interface UploadSheetModalProps {
  teamId: string;
  currentCount: number;
  limitExempt?: boolean;
  onClose: () => void;
  onUploaded: (sheet: SheetRow) => void;
}

export default function UploadSheetModal({
  teamId,
  currentCount,
  limitExempt = false,
  onClose,
  onUploaded,
}: UploadSheetModalProps) {
  const supabase = createClient();
  const atLimit = !limitExempt && currentCount >= MAX_SHEETS_PER_TEAM;

  const [title, setTitle] = useState('');
  const [composer, setComposer] = useState('');
  const [key, setKey] = useState('');
  const [bpm, setBpm] = useState('');
  // PDF는 페이지 수만큼, 이미지는 파일마다 1장씩 펼쳐서 담아둔다. 여러 장이
  // 섞여 있어도 업로드 시점엔 하나로 합쳐 sheets 레코드 1개로 등록한다.
  const [pages, setPages] = useState<PendingPage[]>([]);
  const [expanding, setExpanding] = useState(false);
  const [dropActive, setDropActive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 첫 페이지에서 제목/Key를 자동 인식해 제안하는 기능. 정확도가 100%가
  // 아니므로 결과는 항상 입력 필드에 채워주기만 하고 사용자가 직접 확인·
  // 수정할 수 있게 둔다.
  const [recognizing, setRecognizing] = useState(false);
  const [recognitionNote, setRecognitionNote] = useState<string | null>(null);

  async function addFiles(files: File[]) {
    const valid = files.filter((f) => isAllowedSheetFile(f));
    if (valid.length < files.length) setError(SHEET_FILE_TYPE_HINT);
    else setError(null);
    if (valid.length === 0) return;

    setExpanding(true);
    try {
      const expanded = await Promise.all(valid.map(expandFileToPages));
      setPages((prev) => [...prev, ...expanded.flat()]);
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
  }

  async function handleAutoRecognize() {
    if (pages.length === 0 || recognizing) return;

    setRecognizing(true);
    setRecognitionNote(null);
    try {
      const result = await recognizeSheet(pages[0]);

      if (result.title) setTitle(result.title);
      if (result.key) setKey(result.key);

      if (!result.title && !result.key) {
        setRecognitionNote('제목/Key를 인식하지 못했습니다. 직접 입력해주세요.');
      } else {
        const parts: string[] = [];
        parts.push(result.title ? `제목 "${result.title}"` : '제목 인식 실패');
        parts.push(
          result.key
            ? `Key "${result.key}" (신뢰도 ${result.keyConfidence >= 0.5 ? '높음' : '낮음, 꼭 확인하세요'})`
            : 'Key 인식 실패'
        );
        // Key 추정이 틀렸을 때 "실제로 뭘 읽었길래 이렇게 나왔는지" 바로
        // 보이게, 인식된 코드 원문도 같이 보여준다 (디버깅 목적 겸 사용자가
        // 스스로 신뢰도를 판단하는 데도 도움이 된다).
        if (result.chordsFound.length > 0) {
          parts.push(`인식된 코드: ${result.chordsFound.join(', ')}`);
        }
        setRecognitionNote(`자동 인식: ${parts.join(' · ')} — 채워진 값은 확인 후 필요하면 수정해주세요.`);
      }
    } catch {
      setRecognitionNote('자동 인식 중 문제가 발생했습니다. 직접 입력해주세요.');
    } finally {
      setRecognizing(false);
    }
  }

  function handleDropZoneDrop(e: ReactDragEvent<HTMLLabelElement>) {
    e.preventDefault();
    setDropActive(false);
    const dropped = Array.from(e.dataTransfer.files ?? []);
    if (dropped.length > 0) addFiles(dropped);
  }

  async function handleUpload(e: FormEvent) {
    e.preventDefault();

    if (atLimit) {
      setError(SHEET_LIMIT_MESSAGE);
      return;
    }

    if (pages.length === 0) {
      setError('파일을 선택해주세요.');
      return;
    }

    setLoading(true);
    setError(null);

    let composedFile: File;
    try {
      composedFile = await composePagesIntoFile(pages);
    } catch {
      setLoading(false);
      setError('페이지를 합치지 못했습니다.');
      return;
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setLoading(false);
      setError('로그인이 필요합니다.');
      return;
    }

    const { data: uploadedFile, error: uploadError } = await uploadSheetFile(supabase, teamId, composedFile);

    if (uploadError || !uploadedFile) {
      setLoading(false);
      setError(uploadError ?? '파일을 업로드하지 못했습니다.');
      return;
    }

    const { data: sheet, error: insertError } = await supabase
      .from('sheets')
      .insert({
        team_id: teamId,
        title,
        composer: composer || null,
        key: key || null,
        bpm: bpm ? Number(bpm) : null,
        file_url: uploadedFile.filePath,
        thumbnail_url: uploadedFile.thumbnailPath,
        created_by: user.id,
      })
      .select('id, title, composer, key, bpm, tags, file_url, thumbnail_url, created_at')
      .single();

    setLoading(false);

    if (insertError) {
      setError(insertError.message);
      return;
    }

    onUploaded(sheet);
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

        <h2 className="text-lg font-semibold mb-4">새 악보 추가</h2>

        <form onSubmit={handleUpload} className="flex flex-col gap-4">
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
            <label className="flex flex-col gap-1 text-sm">
              BPM (선택)
              <input
                type="number"
                min={0}
                value={bpm}
                onChange={(e) => setBpm(e.target.value)}
                className="border border-border bg-surface rounded px-3 py-2"
              />
            </label>
          </div>

          <div className="flex flex-col gap-1 text-sm">
            파일 (PDF, PNG, JPG, WEBP — 여러 장 가능)
            <label
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
              <UploadCloud size={20} />
              <span className="text-xs text-center">
                끌어다 놓거나 클릭해서 선택하세요
                <br />
                (PDF 여러 페이지 또는 이미지 여러 장 모두 가능)
              </span>
              <input
                type="file"
                multiple
                accept={SHEET_FILE_ACCEPT}
                onChange={(e) => {
                  const selected = Array.from(e.target.files ?? []);
                  e.target.value = '';
                  if (selected.length > 0) addFiles(selected);
                }}
                className="hidden"
              />
            </label>

            {expanding && <p className="text-xs text-muted">페이지를 불러오는 중...</p>}

            {pages.length > 0 && (
              <>
                <p className="text-xs text-muted mt-1">
                  {pages.length}장 선택됨 — 손잡이로 순서를 바꾸거나 X로 제외할 수 있어요
                </p>
                <PageThumbStrip pages={pages} onReorder={setPages} onRemove={removePage} />

                <button
                  type="button"
                  onClick={handleAutoRecognize}
                  disabled={recognizing}
                  className="mt-1 inline-flex items-center gap-1.5 self-start rounded border border-border px-3 py-1.5 text-xs hover:bg-surface-hover disabled:opacity-50"
                >
                  <Sparkles size={14} />
                  {recognizing ? '인식 중... (몇 초 걸릴 수 있어요)' : '제목·Key 자동 인식 (첫 페이지 기준)'}
                </button>
                {recognitionNote && <p className="text-xs text-muted">{recognitionNote}</p>}
              </>
            )}
          </div>

          {atLimit && <p className="text-sm text-red-600 dark:text-red-400">{SHEET_LIMIT_MESSAGE}</p>}
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
              disabled={loading || expanding || atLimit}
              className="bg-accent text-accent-foreground rounded px-4 py-2 text-sm hover:bg-accent-hover disabled:opacity-50"
            >
              {loading ? '업로드 중...' : '추가하기'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
