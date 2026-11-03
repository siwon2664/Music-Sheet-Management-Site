// 새로 올리는 파일은 Cloudflare R2에 저장하고, 기존 Supabase Storage 파일과
// 구분할 수 있도록 경로 앞에 이 접두사를 붙인다('r2/{teamId}/...'). DB 스키마
// 변경 없이, 경로 문자열 자체로 어느 백엔드에 저장됐는지 구분하기 위함이다 —
// 읽기/삭제 API(app/api/storage/**)가 이 접두사로 분기한다.
const R2_PATH_PREFIX = 'r2/';

export function isR2Path(path: string): boolean {
  return path.startsWith(R2_PATH_PREFIX);
}

// 'r2/{teamId}/{파일명}'에서 teamId를 뽑는다. R2는 Supabase RLS 같은 DB 레벨
// 권한 체크가 없어서, 서버 라우트가 팀 멤버십을 직접 확인하는 데 쓴다.
export function getR2PathTeamId(path: string): string | null {
  if (!isR2Path(path)) return null;
  return path.split('/')[1] || null;
}

// Storage 키는 한글 등 비-ASCII 문자를 허용하지 않으므로
// 원본 파일명 대신 안전한 이름(uuid + 확장자)으로 저장한다.
export function buildSheetStoragePath(teamId: string, fileName: string): string {
  const extMatch = /\.([a-zA-Z0-9]+)$/.exec(fileName);
  const ext = extMatch ? `.${extMatch[1].toLowerCase()}` : '';
  return `${R2_PATH_PREFIX}${teamId}/${crypto.randomUUID()}${ext}`;
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
    filePath: `${R2_PATH_PREFIX}${teamId}/${id}.jpg`,
    thumbnailPath: `${R2_PATH_PREFIX}${teamId}/${id}_thumb.jpg`,
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
  return `${R2_PATH_PREFIX}${teamId}/${crypto.randomUUID()}_thumb.jpg`;
}
