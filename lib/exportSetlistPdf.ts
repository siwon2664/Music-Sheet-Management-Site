import { PDFDocument } from 'pdf-lib';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/supabase';
import { isPdfFile } from './storage';

export interface ExportSetlistItem {
  title: string;
  fileUrl: string | null;
  note: string;
}

interface ExportOptions {
  includeNotes: boolean;
}

interface ExportResult {
  blob: Blob;
  skipped: string[];
}

const MAX_IMAGE_PAGE_POINTS = 1000;
const NOTE_PAGE_WIDTH = 595; // A4 폭(pt)에 맞춰, 별도 스케일 계산 없이 그대로 페이지 폭으로 쓴다.

// pdf-lib은 JPEG/PNG만 임베드할 수 있어서, 원본 포맷이 뭐든(브라우저가 디코딩 가능하면)
// 캔버스를 거쳐 항상 JPEG로 변환한다.
async function imageBytesToJpeg(bytes: Uint8Array): Promise<{ jpegBytes: Uint8Array; width: number; height: number }> {
  const blob = new Blob([bytes as unknown as BlobPart]);
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas context를 생성할 수 없습니다.');
    ctx.drawImage(bitmap, 0, 0);

    const jpegBytes = await new Promise<Uint8Array>((resolve, reject) => {
      canvas.toBlob(
        (b) => {
          if (!b) return reject(new Error('이미지 변환에 실패했습니다.'));
          b.arrayBuffer().then((buf) => resolve(new Uint8Array(buf)));
        },
        'image/jpeg',
        0.92
      );
    });

    return { jpegBytes, width: canvas.width, height: canvas.height };
  } finally {
    bitmap.close();
  }
}

// 메모는 한글 텍스트라 pdf-lib 기본(StandardFonts) 폰트로는 그릴 수 없다.
// 브라우저의 canvas 텍스트 렌더링(시스템 폰트, 한글 지원)으로 그려서 이미지로 만든 뒤 삽입한다.
async function renderNoteToPng(title: string, note: string): Promise<{ pngBytes: Uint8Array; width: number; height: number }> {
  const paddingX = 40;
  const paddingY = 36;
  const lineHeight = 26;
  const titleFont = 'bold 24px sans-serif';
  const bodyFont = '17px sans-serif';
  const maxTextWidth = NOTE_PAGE_WIDTH - paddingX * 2;

  const measureCanvas = document.createElement('canvas');
  const measureCtx = measureCanvas.getContext('2d');
  if (!measureCtx) throw new Error('canvas context를 생성할 수 없습니다.');

  function wrapLine(text: string, font: string): string[] {
    measureCtx!.font = font;
    if (!text) return [''];
    const chars = Array.from(text);
    const wrapped: string[] = [];
    let current = '';
    for (const ch of chars) {
      const attempt = current + ch;
      if (measureCtx!.measureText(attempt).width > maxTextWidth && current) {
        wrapped.push(current);
        current = ch;
      } else {
        current = attempt;
      }
    }
    if (current) wrapped.push(current);
    return wrapped;
  }

  const titleLines = wrapLine(title, titleFont);
  const bodyLines = note.split('\n').flatMap((line) => wrapLine(line, bodyFont));

  const height = paddingY * 2 + titleLines.length * (lineHeight + 6) + 12 + bodyLines.length * lineHeight;

  const canvas = document.createElement('canvas');
  canvas.width = NOTE_PAGE_WIDTH;
  canvas.height = Math.max(height, 120);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas context를 생성할 수 없습니다.');

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.textBaseline = 'top';

  let y = paddingY;
  ctx.font = titleFont;
  ctx.fillStyle = '#111827';
  for (const line of titleLines) {
    ctx.fillText(line, paddingX, y);
    y += lineHeight + 6;
  }

  y += 12;
  ctx.font = bodyFont;
  ctx.fillStyle = '#374151';
  for (const line of bodyLines) {
    ctx.fillText(line, paddingX, y);
    y += lineHeight;
  }

  const pngBytes = await new Promise<Uint8Array>((resolve, reject) => {
    canvas.toBlob(
      (b) => {
        if (!b) return reject(new Error('이미지 변환에 실패했습니다.'));
        b.arrayBuffer().then((buf) => resolve(new Uint8Array(buf)));
      },
      'image/png'
    );
  });

  return { pngBytes, width: canvas.width, height: canvas.height };
}

export async function exportSetlistToPdf(
  supabase: SupabaseClient<Database>,
  items: ExportSetlistItem[],
  options: ExportOptions
): Promise<ExportResult> {
  const validItems = items.filter((it): it is ExportSetlistItem & { fileUrl: string } => !!it.fileUrl);

  if (validItems.length === 0) {
    throw new Error('다운로드할 악보가 없습니다.');
  }

  const { data: signedUrlsData, error: signError } = await supabase.storage
    .from('sheets')
    .createSignedUrls(
      validItems.map((it) => it.fileUrl),
      600
    );

  if (signError || !signedUrlsData) {
    throw new Error(signError?.message ?? '악보 파일을 불러오지 못했습니다.');
  }

  const mergedDoc = await PDFDocument.create();
  const skipped: string[] = [];

  for (let i = 0; i < validItems.length; i++) {
    const item = validItems[i];
    const url = signedUrlsData[i]?.signedUrl;
    if (!url) {
      skipped.push(item.title);
      continue;
    }

    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error('파일을 내려받지 못했습니다.');
      const bytes = new Uint8Array(await response.arrayBuffer());

      if (isPdfFile(item.fileUrl)) {
        const srcDoc = await PDFDocument.load(bytes, { ignoreEncryption: true });
        const copiedPages = await mergedDoc.copyPages(srcDoc, srcDoc.getPageIndices());
        copiedPages.forEach((page) => mergedDoc.addPage(page));
      } else {
        const { jpegBytes, width, height } = await imageBytesToJpeg(bytes);
        const scale = Math.min(1, MAX_IMAGE_PAGE_POINTS / Math.max(width, height));
        const pageWidth = width * scale;
        const pageHeight = height * scale;

        const embedded = await mergedDoc.embedJpg(jpegBytes);
        const page = mergedDoc.addPage([pageWidth, pageHeight]);
        page.drawImage(embedded, { x: 0, y: 0, width: pageWidth, height: pageHeight });
      }

      if (options.includeNotes && item.note.trim()) {
        const { pngBytes, width, height } = await renderNoteToPng(item.title, item.note.trim());
        const embedded = await mergedDoc.embedPng(pngBytes);
        const page = mergedDoc.addPage([width, height]);
        page.drawImage(embedded, { x: 0, y: 0, width, height });
      }
    } catch {
      skipped.push(item.title);
    }
  }

  if (mergedDoc.getPageCount() === 0) {
    throw new Error('악보를 하나도 포함하지 못했습니다.');
  }

  const pdfBytes = await mergedDoc.save();
  return { blob: new Blob([pdfBytes as unknown as BlobPart], { type: 'application/pdf' }), skipped };
}
