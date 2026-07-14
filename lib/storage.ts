// Supabase Storage 키는 한글 등 비-ASCII 문자를 허용하지 않으므로
// 원본 파일명 대신 안전한 이름(uuid + 확장자)으로 저장한다.
export function buildSheetStoragePath(teamId: string, fileName: string): string {
  const extMatch = /\.([a-zA-Z0-9]+)$/.exec(fileName);
  const ext = extMatch ? `.${extMatch[1].toLowerCase()}` : '';
  return `${teamId}/${crypto.randomUUID()}${ext}`;
}

export function stripFileExtension(fileName: string): string {
  return fileName.replace(/\.[a-zA-Z0-9]+$/, '');
}

export function isPdfFile(fileUrl: string): boolean {
  return fileUrl.toLowerCase().endsWith('.pdf');
}
