import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Band Setlist',
  description: '밴드 팀 및 악보 관리',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
