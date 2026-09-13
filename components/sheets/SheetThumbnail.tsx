'use client';

import { Music } from 'lucide-react';
import { isPdfFile } from '@/lib/storage';

interface SheetThumbnailProps {
  title: string;
  fileUrl: string | null;
  // 실제 이미지든, PDF 첫 페이지를 미리 렌더링해둔 것이든 — 이 값이 있으면 진짜
  // 미리보기를 보여줄 수 있다는 뜻이다. (PDF는 업로드 시점에 이 썸네일을 같이
  // 만들어두므로, 이 기능이 추가되기 전에 올린 PDF는 이 값이 없다.)
  thumbnailUrl: string | null;
  signedUrl?: string;
  // 크기 오버라이드 — 안 주면 라이브러리 테이블에서 쓰는 기본 40x40 크기를 그대로 쓴다.
  // 콘티 목록처럼 카드 높이에 맞춰 크게 늘어나야 하는 곳에서는 "w-20 h-full" 같은
  // 값을 넘긴다.
  className?: string;
  // object-fit — 작은 정사각형 아이콘은 cover(꽉 채움)가 자연스럽고, 세로로 긴
  // 큰 썸네일은 contain으로 악보 내용이 잘리지 않게 한다. 기본은 cover(기존 동작 유지).
  fit?: 'cover' | 'contain';
}

const DEFAULT_SIZE_CLASS = 'w-10 h-10';

export default function SheetThumbnail({
  title,
  fileUrl,
  thumbnailUrl,
  signedUrl,
  className,
  fit = 'cover',
}: SheetThumbnailProps) {
  const sizeClass = className ?? DEFAULT_SIZE_CLASS;

  if (!fileUrl) {
    return (
      <div className={`${sizeClass} shrink-0 rounded bg-surface-hover flex items-center justify-center text-muted`}>
        <Music size={16} />
      </div>
    );
  }

  // thumbnailUrl이 있으면(이미지든 PDF든) 당연히 진짜 미리보기를 보여줄 수 있고,
  // thumbnailUrl이 없어도 파일 자체가 PDF가 아니라면(예: 썸네일 생성이 실패한
  // 이미지) file_url 자체가 미리보기로 쓸 만한 이미지이므로 signedUrl은 그쪽에서
  // 이미 채워져 들어온다 — 어느 쪽이든 여기서는 signedUrl만 있으면 그대로 보여준다.
  const hasPreview = Boolean(thumbnailUrl) || !isPdfFile(fileUrl);

  if (hasPreview) {
    if (!signedUrl) {
      return <div className={`${sizeClass} shrink-0 rounded bg-surface-hover animate-pulse`} />;
    }

    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={signedUrl}
        alt={title}
        className={`${sizeClass} shrink-0 rounded border border-border ${
          fit === 'contain' ? 'object-contain bg-surface' : 'object-cover'
        }`}
      />
    );
  }

  // 썸네일이 없는 PDF — 이 기능이 추가되기 전에 올려졌거나 썸네일 생성에 실패한 경우다.
  return (
    <div
      className={`${sizeClass} shrink-0 rounded bg-red-50 dark:bg-red-500/10 flex items-center justify-center text-red-500 dark:text-red-400 text-[9px] font-semibold`}
    >
      PDF
    </div>
  );
}
