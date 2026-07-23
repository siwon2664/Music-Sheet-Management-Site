// 악보 업로드는 PDF/이미지만 허용한다.
// HEIC(아이폰 카메라 기본 형식)는 제외 — Chrome/Windows 등 다수 브라우저가 <img>로 렌더링하지 못해
// 다른 팀원 화면에서 깨진 이미지로 보일 수 있다.
export const ALLOWED_SHEET_EXTENSIONS = ['.pdf', '.png', '.jpg', '.jpeg', '.webp'] as const;

export const ALLOWED_SHEET_MIME_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
] as const;

export const SHEET_FILE_ACCEPT = ALLOWED_SHEET_EXTENSIONS.join(',');

export const SHEET_FILE_TYPE_HINT = 'PDF, PNG, JPG, WEBP 파일만 업로드할 수 있습니다.';

function getExtension(fileName: string): string {
  const idx = fileName.lastIndexOf('.');
  return idx === -1 ? '' : fileName.slice(idx).toLowerCase();
}

export function isAllowedSheetFile(file: File): boolean {
  return ALLOWED_SHEET_EXTENSIONS.includes(getExtension(file.name) as (typeof ALLOWED_SHEET_EXTENSIONS)[number]);
}
