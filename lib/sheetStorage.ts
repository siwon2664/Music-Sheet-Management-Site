// 기존에 컴포넌트들이 직접 호출하던 supabase.storage.from('sheets').createSignedUrl(s)
// / .upload() / .remove() 대신, 서버 라우트(app/api/storage/**)를 거치는 드롭인
// 헬퍼들. R2는 Supabase Storage처럼 RLS로 권한을 걸 수 없어서, 읽기/쓰기/삭제 전부
// 서버에서 팀 멤버십을 확인하는 이 라우트들을 거쳐야 한다.

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const payload = await res.json().catch(() => null);
    throw new Error(payload?.error ?? `요청에 실패했습니다 (${res.status}).`);
  }
  return res.json();
}

// 기존 supabase.storage.createSignedUrls(paths, ttl)와 같은 순서로 응답한다.
export async function getSignedSheetUrls(paths: string[]): Promise<(string | null)[]> {
  if (paths.length === 0) return [];
  const { urls } = await postJson<{ urls: (string | null)[] }>('/api/storage/signed-urls', { paths });
  return urls;
}

export async function getSignedSheetUrl(path: string): Promise<string | null> {
  const [url] = await getSignedSheetUrls([path]);
  return url ?? null;
}

export async function removeSheetFiles(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  await postJson('/api/storage/remove', { paths });
}

// 서버에서 presigned PUT URL만 받아오고, 실제 파일 바이트는 브라우저가 R2로
// 직접 전송한다(큰 PDF도 서버 요청 본문 크기 제한에 걸리지 않도록).
export async function uploadToR2(path: string, contentType: string, body: Blob): Promise<void> {
  const { uploadUrl } = await postJson<{ uploadUrl: string }>('/api/storage/upload-url', {
    path,
    contentType,
  });

  const putRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    body,
  });
  if (!putRes.ok) throw new Error('파일 업로드에 실패했습니다.');
}
