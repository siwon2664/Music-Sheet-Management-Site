// 연주모드에서 온라인으로 한 번 연 악보 파일/필기를 Cache Storage API에 저장해두고,
// 이후 오프라인일 때 signed URL 대신 이 캐시를 읽어 화면에 계속 보여주기 위한 유틸리티.
// signed URL은 만료되는 임시 주소라 그대로 캐시 키로 쓸 수 없으므로, sheetId를
// 캐시 키로 쓰고 sheets.updated_at을 버전 구분자로 함께 사용한다.

const SHEET_FILE_CACHE_NAME = 'sheet-files-v1';
const DRAWING_CACHE_NAME = 'sheet-drawings-v1';

function isCacheStorageSupported(): boolean {
  return typeof window !== 'undefined' && 'caches' in window;
}

function sheetFileCacheKey(sheetId: string, updatedAt: string): string {
  return `https://cache.local/sheets/${sheetId}?updatedAt=${encodeURIComponent(updatedAt)}`;
}

function sheetFileCachePrefix(sheetId: string): string {
  return `https://cache.local/sheets/${sheetId}?`;
}

function drawingCacheKey(sheetId: string, userId: string): string {
  return `https://cache.local/drawings/${sheetId}/${userId}`;
}

export async function cacheSheetFile(sheetId: string, updatedAt: string, blob: Blob): Promise<void> {
  if (!isCacheStorageSupported()) return;

  try {
    const cache = await caches.open(SHEET_FILE_CACHE_NAME);
    const key = sheetFileCacheKey(sheetId, updatedAt);

    // 재업로드로 updated_at이 바뀌면 새 키로 저장되므로, 같은 sheetId의 이전 버전은
    // 정리해준다(안 그러면 버릴 파일이 저장공간을 계속 차지한다).
    const prefix = sheetFileCachePrefix(sheetId);
    const keys = await cache.keys();
    await Promise.all(
      keys.filter((req) => req.url.startsWith(prefix) && req.url !== key).map((req) => cache.delete(req))
    );

    await cache.put(key, new Response(blob));
  } catch (err) {
    // QuotaExceededError 등 저장 실패는 베스트 에포트로 무시한다 — 캐싱 실패가
    // 화면 표시를 막으면 안 된다.
    console.warn('[offlineSheetCache] failed to cache sheet file', err);
  }
}

export async function getCachedSheetFile(sheetId: string, updatedAt: string): Promise<Blob | null> {
  if (!isCacheStorageSupported()) return null;

  try {
    const cache = await caches.open(SHEET_FILE_CACHE_NAME);
    const res = await cache.match(sheetFileCacheKey(sheetId, updatedAt));
    if (!res) return null;
    return await res.blob();
  } catch (err) {
    console.warn('[offlineSheetCache] failed to read cached sheet file', err);
    return null;
  }
}

export async function isSheetCached(sheetId: string, updatedAt: string): Promise<boolean> {
  if (!isCacheStorageSupported()) return false;

  try {
    const cache = await caches.open(SHEET_FILE_CACHE_NAME);
    const res = await cache.match(sheetFileCacheKey(sheetId, updatedAt));
    return !!res;
  } catch (err) {
    console.warn('[offlineSheetCache] failed to check cached sheet file', err);
    return false;
  }
}

export async function cacheDrawing(
  sheetId: string,
  userId: string,
  updatedAt: string,
  strokes: unknown
): Promise<void> {
  if (!isCacheStorageSupported()) return;

  try {
    const cache = await caches.open(DRAWING_CACHE_NAME);
    const body = JSON.stringify({ strokes, updatedAt });
    await cache.put(
      drawingCacheKey(sheetId, userId),
      new Response(body, { headers: { 'Content-Type': 'application/json' } })
    );
  } catch (err) {
    console.warn('[offlineSheetCache] failed to cache drawing', err);
  }
}

export async function getCachedDrawing(sheetId: string, userId: string): Promise<unknown | null> {
  if (!isCacheStorageSupported()) return null;

  try {
    const cache = await caches.open(DRAWING_CACHE_NAME);
    const res = await cache.match(drawingCacheKey(sheetId, userId));
    if (!res) return null;
    const json = (await res.json()) as { strokes?: unknown };
    return json.strokes ?? null;
  } catch (err) {
    console.warn('[offlineSheetCache] failed to read cached drawing', err);
    return null;
  }
}

export async function clearOfflineCache(): Promise<void> {
  if (!isCacheStorageSupported()) return;

  try {
    await caches.delete(SHEET_FILE_CACHE_NAME);
    await caches.delete(DRAWING_CACHE_NAME);
  } catch (err) {
    console.warn('[offlineSheetCache] failed to clear offline cache', err);
  }
}

export async function estimateCacheUsage(): Promise<{ usageBytes: number; quotaBytes: number } | null> {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return null;

  try {
    const { usage, quota } = await navigator.storage.estimate();
    if (usage === undefined || quota === undefined) return null;
    return { usageBytes: usage, quotaBytes: quota };
  } catch (err) {
    console.warn('[offlineSheetCache] failed to estimate cache usage', err);
    return null;
  }
}
