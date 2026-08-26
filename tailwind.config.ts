import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class',
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      // globals.css의 CSS 변수(라이트: :root, 다크: .dark)를 그대로 참조한다.
      // 예: bg-background, text-foreground, border-border, bg-accent text-accent-foreground
      colors: {
        background: 'var(--background)',
        surface: 'var(--surface)',
        'surface-hover': 'var(--surface-hover)',
        foreground: 'var(--foreground)',
        muted: 'var(--muted-foreground)',
        border: {
          DEFAULT: 'var(--border)',
          strong: 'var(--border-strong)',
        },
        accent: {
          DEFAULT: 'var(--accent)',
          hover: 'var(--accent-hover)',
          foreground: 'var(--accent-foreground)',
          subtle: 'var(--accent-subtle)',
          'subtle-foreground': 'var(--accent-subtle-foreground)',
        },
      },
    },
  },
  plugins: [],
};

export default config;
