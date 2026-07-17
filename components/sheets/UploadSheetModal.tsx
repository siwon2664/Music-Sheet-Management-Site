'use client';

import { useState, type FormEvent } from 'react';
import { UploadCloud, X } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { uploadSheetFile } from '@/lib/sheetUpload';
import type { SheetRow } from './SheetsLibraryClient';

interface UploadSheetModalProps {
  teamId: string;
  onClose: () => void;
  onUploaded: (sheet: SheetRow) => void;
}

export default function UploadSheetModal({ teamId, onClose, onUploaded }: UploadSheetModalProps) {
  const supabase = createClient();

  const [title, setTitle] = useState('');
  const [composer, setComposer] = useState('');
  const [key, setKey] = useState('');
  const [bpm, setBpm] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleUpload(e: FormEvent) {
    e.preventDefault();

    if (!file) {
      setError('파일을 선택해주세요.');
      return;
    }

    setLoading(true);
    setError(null);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setLoading(false);
      setError('로그인이 필요합니다.');
      return;
    }

    const { data: uploadedFile, error: uploadError } = await uploadSheetFile(supabase, teamId, file);

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
      <div className="bg-white rounded-lg shadow-lg w-full max-w-sm p-6 relative">
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-400 hover:text-gray-600"
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
            <label className="flex flex-col gap-1 text-sm">
              BPM (선택)
              <input
                type="number"
                min={0}
                value={bpm}
                onChange={(e) => setBpm(e.target.value)}
                className="border rounded px-3 py-2"
              />
            </label>
          </div>

          <label className="flex flex-col gap-1 text-sm">
            파일 (PDF, 이미지 등)
            <div className="border border-dashed rounded px-3 py-4 flex flex-col items-center gap-2 text-gray-500">
              <UploadCloud size={20} />
              <input
                type="file"
                required
                accept=".pdf,image/*"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="text-xs"
              />
              {file && <p className="text-xs text-gray-600">{file.name}</p>}
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
              {loading ? '업로드 중...' : '추가하기'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
