// 목록 썸네일 signed URL을 페이지를 열 때마다 새로 발급받지 않도록 세션 동안 캐시한다.
// Supabase 쪽 서명 유효기간(60분)보다 짧게 잡아 만료 직전에 깨지는 걸 피한다.
const CACHE_PREFIX = 'sheet-thumb-url:';
const TTL_MS = 50 * 60 * 1000;

interface CacheEntry {
  url: string;
  expiresAt: number;
}

export function getCachedSignedUrl(path: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(CACHE_PREFIX + path);
    if (!raw) return null;
    const entry: CacheEntry = JSON.parse(raw);
    if (entry.expiresAt < Date.now()) {
      sessionStorage.removeItem(CACHE_PREFIX + path);
      return null;
    }
    return entry.url;
  } catch {
    return null;
  }
}

export function setCachedSignedUrl(path: string, url: string): void {
  if (typeof window === 'undefined') return;
  try {
    const entry: CacheEntry = { url, expiresAt: Date.now() + TTL_MS };
    sessionStorage.setItem(CACHE_PREFIX + path, JSON.stringify(entry));
  } catch {
    // sessionStorage가 꽉 찼거나 사용 불가능한 환경이면 캐싱을 건너뛴다.
  }
}
