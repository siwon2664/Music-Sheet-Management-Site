// 서버(Vercel)는 UTC, 사용자 브라우저는 대부분 KST라 시간대를 지정하지 않으면 같은
// 시각도 날짜가 다르게 나와 하이드레이션 오류가 난다. 서버와 클라이언트가 함께
// 렌더링하는 날짜는 이 시간대로 고정한다.
export const SERVICE_TIME_ZONE = 'Asia/Seoul';

// 'YYYY-MM-DD'
export function todayKeyInKorea(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: SERVICE_TIME_ZONE });
}
