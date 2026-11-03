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

export const MAX_SHEET_FILE_BYTES = 50 * 1024 * 1024;

const SHEET_MIME_BY_EXTENSION: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

// lib/storage.ts의 경로 빌더가 만드는 'r2/{teamId}/{uuid}[_thumb].확장자' 형식만 허용한다.
const R2_UPLOAD_PATH = /^r2\/[0-9a-f-]{36}\/[0-9a-f-]{36}(_thumb)?\.[a-z]+$/;

// R2에는 Supabase 버킷의 형식 제한이 없어서 업로드 URL 발급 라우트에서 대신 검사한다.
// 문제가 있으면 사용자에게 보여줄 메시지를, 없으면 null을 돌려준다.
export function validateSheetUpload(path: string, contentType: string, size: number): string | null {
  if (typeof path !== 'string' || !R2_UPLOAD_PATH.test(path)) return '잘못된 경로입니다.';
  const expectedType = SHEET_MIME_BY_EXTENSION[getExtension(path)];
  if (!expectedType || expectedType !== contentType) return SHEET_FILE_TYPE_HINT;
  if (!Number.isInteger(size) || size <= 0) return '파일 크기를 확인할 수 없습니다.';
  if (size > MAX_SHEET_FILE_BYTES) {
    return `파일이 너무 큽니다. 최대 ${MAX_SHEET_FILE_BYTES / 1024 / 1024}MB까지 업로드할 수 있습니다.`;
  }
  return null;
}
