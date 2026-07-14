'use client';

import { Music } from 'lucide-react';
import { isPdfFile } from '@/lib/storage';

interface SheetThumbnailProps {
  title: string;
  fileUrl: string | null;
  signedUrl?: string;
}

export default function SheetThumbnail({ title, fileUrl, signedUrl }: SheetThumbnailProps) {
  if (!fileUrl) {
    return (
      <div className="w-10 h-10 shrink-0 rounded bg-gray-100 flex items-center justify-center text-gray-300">
        <Music size={16} />
      </div>
    );
  }

  if (isPdfFile(fileUrl)) {
    return (
      <div className="w-10 h-10 shrink-0 rounded bg-red-50 flex items-center justify-center text-red-400 text-[9px] font-semibold">
        PDF
      </div>
    );
  }

  if (!signedUrl) {
    return <div className="w-10 h-10 shrink-0 rounded bg-gray-100 animate-pulse" />;
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={signedUrl} alt={title} className="w-10 h-10 shrink-0 rounded object-cover border" />
  );
}
