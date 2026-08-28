// Supabase Storage 키는 한글 등 비-ASCII 문자를 허용하지 않으므로
// 원본 파일명 대신 안전한 이름(uuid + 확장자)으로 저장한다.
export function buildSheetStoragePath(teamId: string, fileName: string): string {
  const extMatch = /\.([a-zA-Z0-9]+)$/.exec(fileName);
  const ext = extMatch ? `.${extMatch[1].toLowerCase()}` : '';
  return `${teamId}/${crypto.randomUUID()}${ext}`;
}

// 표시용 이미지와 목록 썸네일은 같은 id를 공유하는 쌍으로 관리한다.
export function buildSheetImagePaths(teamId: string, fileName: string): {
  id: string;
  filePath: string;
  thumbnailPath: string;
} {
  const id = crypto.randomUUID();
  return {
    id,
    filePath: `${teamId}/${id}.jpg`,
    thumbnailPath: `${teamId}/${id}_thumb.jpg`,
  };
}

export function stripFileExtension(fileName: string): string {
  return fileName.replace(/\.[a-zA-Z0-9]+$/, '');
}

export function isPdfFile(fileUrl: string): boolean {
  return fileUrl.toLowerCase().endsWith('.pdf');
}

// PDF는 원본 파일과 별도로 목록용 썸네일(첫 페이지를 렌더링한 jpg) 하나만 올리면
// 되므로, 이미지처럼 원본과 짝을 맞출 필요 없이 독립된 경로를 하나 발급한다.
export function buildSheetThumbnailPath(teamId: string): string {
  return `${teamId}/${crypto.randomUUID()}_thumb.jpg`;
}
