import type { Metadata, Viewport } from 'next';
import ThemeProvider from '@/components/ThemeProvider';
import './globals.css';

export const metadata: Metadata = {
  title: 'Band Setlist',
  description: '밴드 팀 및 악보 관리',
};

// 하단 탭바가 iPhone/iPad의 홈 인디케이터 영역과 겹치지 않도록, 그 여백만큼
// 안전영역을 확보할 수 있게 한다 (viewportFit: 'cover'가 있어야 CSS의
// env(safe-area-inset-bottom)이 실제 값을 갖는다).
export const viewport: Viewport = {
  viewportFit: 'cover',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // suppressHydrationWarning: next-themes가 첫 렌더 직후 실제 테마에 맞게
    // class="dark"를 붙이는데, 이때 서버가 렌더링한 값과 한 프레임 다를 수
    // 있어 생기는(실제로는 문제 없는) 경고를 여기서만 눌러준다.
    <html lang="ko" suppressHydrationWarning>
      <body>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
