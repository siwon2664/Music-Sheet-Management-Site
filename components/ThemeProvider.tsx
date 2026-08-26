'use client';

import { ThemeProvider as NextThemesProvider } from 'next-themes';
import type { ComponentProps } from 'react';

// next-themes를 그대로 감싸기만 한다 — <html>에 class="dark"를 붙였다 뗐다 하는
// 실제 동작은 라이브러리가 다 처리하고, 여기서는 프로젝트 기본값만 정한다.
export default function ThemeProvider({ children, ...props }: ComponentProps<typeof NextThemesProvider>) {
  return (
    <NextThemesProvider attribute="class" defaultTheme="dark" enableSystem {...props}>
      {children}
    </NextThemesProvider>
  );
}
