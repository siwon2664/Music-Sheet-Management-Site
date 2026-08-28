import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/supabase';
import { buildSheetImagePaths, buildSheetStoragePath, buildSheetThumbnailPath } from './storage';
import { createDisplayImage, createThumbnailImage, isResizableImage } from './image';
import { createPdfThumbnailImage } from './pageCompose';
import { isAllowedSheetFile, SHEET_FILE_TYPE_HINT } from './fileTypes';

function isPdfFile(file: File): boolean {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
}

export interface SheetUploadResult {
  filePath: string;
  thumbnailPath: string | null;
}

// 이미지는 표시용/썸네일용으로 리사이즈해서 올린다 (업로드 용량, 목록 조회 속도 개선 목적).
// 브라우저가 디코딩하지 못하는 형식(HEIC 등)이면 리사이즈를 건너뛰고 원본을 그대로 올린다.
export async function uploadSheetFile(
  supabase: SupabaseClient<Database>,
  teamId: string,
  file: File
): Promise<{ data: SheetUploadResult | null; error: string | null }> {
  if (!isAllowedSheetFile(file)) {
    return { data: null, error: SHEET_FILE_TYPE_HINT };
  }

  if (isResizableImage(file)) {
    const paths = buildSheetImagePaths(teamId, file.name);

    let displayImage: File | null = null;
    let thumbnailImage: File | null = null;
    try {
      [displayImage, thumbnailImage] = await Promise.all([
        createDisplayImage(file, paths.id),
        createThumbnailImage(file, paths.id),
      ]);
    } catch {
      displayImage = null;
      thumbnailImage = null;
    }

    const filePath = displayImage ? paths.filePath : buildSheetStoragePath(teamId, file.name);
    const { error: uploadError } = await supabase.storage
      .from('sheets')
      .upload(filePath, displayImage ?? file);

    if (uploadError) return { data: null, error: uploadError.message };

    let thumbnailPath: string | null = null;
    if (thumbnailImage) {
      const { error: thumbError } = await supabase.storage
        .from('sheets')
        .upload(paths.thumbnailPath, thumbnailImage);
      if (!thumbError) thumbnailPath = paths.thumbnailPath;
    }

    return { data: { filePath, thumbnailPath }, error: null };
  }

  const filePath = buildSheetStoragePath(teamId, file.name);
  const { error: uploadError } = await supabase.storage.from('sheets').upload(filePath, file);
  if (uploadError) return { data: null, error: uploadError.message };

  // PDF는 원본은 그대로 올리고, 목록에서 보여줄 첫 페이지 미리보기만 별도로 만들어
  // 함께 올린다. 썸네일 생성이 실패해도(손상된 PDF 등) 원본 업로드 자체는 이미
  // 끝난 뒤라 조용히 넘어간다 — 목록에서는 기존처럼 PDF 아이콘만 보이게 된다.
  let thumbnailPath: string | null = null;
  if (isPdfFile(file)) {
    try {
      const thumbnailImage = await createPdfThumbnailImage(file);
      if (thumbnailImage) {
        const path = buildSheetThumbnailPath(teamId);
        const { error: thumbError } = await supabase.storage.from('sheets').upload(path, thumbnailImage);
        if (!thumbError) thumbnailPath = path;
      }
    } catch {
      thumbnailPath = null;
    }
  }

  return { data: { filePath, thumbnailPath }, error: null };
}
