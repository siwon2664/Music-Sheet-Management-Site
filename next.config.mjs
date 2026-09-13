/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Next 14.2부터 도입된 클라이언트 라우터 캐시가 searchParams만 바뀌는
    // 페이지(예: /dashboard?year=&month=)도 기본 30초간 캐시해버린다.
    // 그 결과 대시보드에서 달력을 다른 달로 넘겼다가 돌아오면, 실제로는
    // DB에 데이터가 있어도 예전에 캐시된(비어있던) 화면이 다시 보이는
    // 버그가 생긴다(강력 새로고침하면 정상적으로 보이는 게 그 증거).
    // dynamic 페이지의 캐시 유효시간을 0으로 줘서 이동할 때마다 항상
    // 서버에서 새로 데이터를 가져오도록 한다.
    staleTimes: {
      dynamic: 0,
    },
  },
};

export default nextConfig;
