'use client';

import { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';
import { Laptop, Moon, Sun } from 'lucide-react';

const OPTIONS = [
  { value: 'light', label: '라이트', Icon: Sun },
  { value: 'dark', label: '다크', Icon: Moon },
  { value: 'system', label: '시스템', Icon: Laptop },
] as const;

// 프로필 메뉴 안에 넣는 라이트/다크/시스템 3단 스위치.
export default function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  // next-themes는 마운트되기 전엔 실제 테마를 알 수 없다(서버는 모름) — 그
  // 전에 아무 값이나 렌더링해버리면 하이드레이션 시점에 깜빡이므로, 마운트
  // 전에는 자리만 차지하는 빈 틀을 보여준다.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <div className="px-4 py-2 border-t border-border">
      <p className="text-xs text-muted mb-2">화면 테마</p>
      <div className="flex gap-1 bg-surface-hover rounded-lg p-1">
        {OPTIONS.map(({ value, label, Icon }) => {
          const active = mounted && theme === value;
          return (
            <button
              key={value}
              type="button"
              onClick={() => setTheme(value)}
              aria-pressed={active}
              className={`flex-1 flex items-center justify-center gap-1 rounded-md py-1.5 text-xs font-medium transition-colors ${
                active ? 'bg-surface shadow-sm text-foreground' : 'text-muted hover:text-foreground'
              }`}
            >
              <Icon size={13} />
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
