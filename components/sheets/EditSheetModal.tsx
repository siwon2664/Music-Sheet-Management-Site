'use client';

import { useState, type FormEvent } from 'react';
import { UploadCloud, X } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { uploadSheetFile } from '@/lib/sheetUpload';
import type { SheetRow } from './SheetsLibraryClient';

interface EditSheetModalProps {
  sheet: SheetRow;
  teamId: string;
  onClose: () => void;
  onUpdated: (sheet: SheetRow) => void;
}

export default function EditSheetModal({ sheet, teamId, onClose, onUpdated }: EditSheetModalProps) {
  const supabase = createClient();

  const [title, setTitle] = useState(sheet.title);
  const [composer, setComposer] = useState(sheet.composer ?? '');
  const [key, setKey] = useState(sheet.key ?? '');
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    let fileFields: { file_url: string; thumbnail_url: string | null } | null = null;

    if (file) {
      const { data: uploadedFile, error: uploadError } = await uploadSheetFile(supabase, teamId, file);
      if (uploadError || !uploadedFile) {
        setLoading(false);
        setError(uploadError ?? '파일을 업로드하지 못했습니다.');
        return;
      }
      fileFields = { file_url: uploadedFile.filePath, thumbnail_url: uploadedFile.thumbnailPath };
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
      <div className="bg-white rounded-lg shadow-lg w-full max-w-sm p-6 relative">
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-400 hover:text-gray-600"
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
              className="border rounded px-3 py-2"
              autoFocus
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            작곡가 (선택)
            <input
              type="text"
              value={composer}
              onChange={(e) => setComposer(e.target.value)}
              className="border rounded px-3 py-2"
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
                className="border rounded px-3 py-2"
              />
            </label>
            {sheet.bpm && (
              <div className="flex flex-col gap-1 text-sm">
                <span>BPM</span>
                <p className="px-3 py-2 text-gray-500">{sheet.bpm}</p>
              </div>
            )}
          </div>

          <label className="flex flex-col gap-1 text-sm">
            파일 교체 (선택)
            <div className="border border-dashed rounded px-3 py-4 flex flex-col items-center gap-2 text-gray-500">
              <UploadCloud size={20} />
              <input
                type="file"
                accept=".pdf,image/*"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="text-xs"
              />
              <p className="text-xs text-gray-600">
                {file ? file.name : '선택하지 않으면 기존 파일이 유지됩니다.'}
              </p>
            </div>
          </label>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex gap-2 justify-end mt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded px-4 py-2 text-sm border hover:bg-gray-50"
            >
              취소
            </button>
            <button
              type="submit"
              disabled={loading}
              className="bg-black text-white rounded px-4 py-2 text-sm disabled:opacity-50"
            >
              {loading ? '저장 중...' : '저장하기'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
