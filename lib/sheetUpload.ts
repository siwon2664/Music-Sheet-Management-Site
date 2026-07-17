import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/supabase';
import { buildSheetImagePaths, buildSheetStoragePath } from './storage';
import { createDisplayImage, createThumbnailImage, isResizableImage } from './image';

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

  return { data: { filePath, thumbnailPath: null }, error: null };
}
