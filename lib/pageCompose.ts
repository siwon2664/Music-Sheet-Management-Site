import { PDFDocument } from 'pdf-lib';

// 업로드 화면에서 "낱장" 하나를 표현한다. PDF를 선택하면 페이지 수만큼,
// 이미지를 선택하면 파일 하나당 1개씩 만들어져 가로 스트립에 나열된다.
export interface PendingPage {
  id: string;
  kind: 'image' | 'pdf-page';
  file: File; // kind==='pdf-page'일 때는 이 페이지가 속한 원본 PDF 파일 전체
  pageIndex?: number; // kind==='pdf-page'일 때 0-based 페이지 인덱스
  thumbnailUrl: string;
  sourceLabel: string;
}

const THUMB_MAX_EDGE = 220;
const RASTER_JPEG_QUALITY = 0.92;

async function loadPdfjs() {
  const pdfjsLib = await import('pdfjs-dist');
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;
  return pdfjsLib;
}

function isPdf(file: File): boolean {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
}

// 파일 하나를 낱장 목록으로 펼친다. PDF면 페이지마다 미리보기를 그려서
// 여러 개로, 이미지면 그 파일 자체로 1개짜리 목록을 반환한다.
export async function expandFileToPages(file: File): Promise<PendingPage[]> {
  if (!isPdf(file)) {
    return [
      {
        id: crypto.randomUUID(),
        kind: 'image',
        file,
        thumbnailUrl: URL.createObjectURL(file),
        sourceLabel: file.name,
      },
    ];
  }

  const pdfjsLib = await loadPdfjs();
  const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages: PendingPage[] = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const unscaledViewport = page.getViewport({ scale: 1 });
    const scale = THUMB_MAX_EDGE / Math.max(unscaledViewport.width, unscaledViewport.height);
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(viewport.width));
    canvas.height = Math.max(1, Math.round(viewport.height));
    const ctx = canvas.getContext('2d');
    if (ctx) await page.render({ canvasContext: ctx, viewport }).promise;

    pages.push({
      id: crypto.randomUUID(),
      kind: 'pdf-page',
      file,
      pageIndex: pageNumber - 1,
      thumbnailUrl: canvas.toDataURL('image/jpeg', 0.8),
      sourceLabel: pdf.numPages > 1 ? `${file.name} · ${pageNumber}/${pdf.numPages}` : file.name,
    });
  }

  return pages;
}

// 낱장 하나를 표시했던 미리보기 리소스를 정리한다(이미지는 objectURL이라
// 해제해줘야 하고, PDF 페이지는 data URL이라 별도 해제가 필요 없다).
export function revokePagePreview(page: PendingPage): void {
  if (page.kind === 'image') URL.revokeObjectURL(page.thumbnailUrl);
}

const LIBRARY_THUMB_MAX_EDGE = 240;
const LIBRARY_THUMB_JPEG_QUALITY = 0.7;

// 악보 라이브러리 목록에 쓸 PDF 첫 페이지 썸네일을 만든다. 위 expandFileToPages의
// 페이지별 미리보기 렌더링과 같은 pdfjs 경로를 쓰되, 목록 썸네일 크기/화질
// (createThumbnailImage와 동일한 240px · 0.7)에 맞춰 별도 jpg 파일로 뽑아낸다.
// 렌더링에 실패해도(손상된 PDF 등) 업로드 자체는 막으면 안 되므로 null만 돌려준다.
export async function createPdfThumbnailImage(file: File): Promise<File | null> {
  try {
    const pdfjsLib = await loadPdfjs();
    const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
    const page = await pdf.getPage(1);
    const unscaledViewport = page.getViewport({ scale: 1 });
    const scale = LIBRARY_THUMB_MAX_EDGE / Math.max(unscaledViewport.width, unscaledViewport.height);
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(viewport.width));
    canvas.height = Math.max(1, Math.round(viewport.height));
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    await page.render({ canvasContext: ctx, viewport }).promise;

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', LIBRARY_THUMB_JPEG_QUALITY)
    );
    if (!blob) return null;

    return new File([blob], 'thumb.jpg', { type: 'image/jpeg' });
  } catch {
    return null;
  }
}

async function rasterizeImageToJpeg(file: File): Promise<{ bytes: Uint8Array; width: number; height: number }> {
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('캔버스를 생성하지 못했습니다.');
    ctx.drawImage(bitmap, 0, 0);

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('이미지 변환에 실패했습니다.'))),
        'image/jpeg',
        RASTER_JPEG_QUALITY
      );
    });

    return { bytes: new Uint8Array(await blob.arrayBuffer()), width: canvas.width, height: canvas.height };
  } finally {
    bitmap.close();
  }
}

// 남은 낱장들을 하나의 파일로 합친다. 이미지 한 장뿐이면 원본을 그대로 써서
// (기존 리사이즈/썸네일 파이프라인을 그대로 태우도록) 화질 손실 없이 처리하고,
// 그 외(페이지가 여러 장이거나 PDF 페이지가 섞여 있으면)에는 pdf-lib로 새
// PDF를 만든다 — PDF에서 온 페이지는 copyPages로 벡터 그대로 옮기고, 이미지는
// 래스터화해서 페이지로 삽입한다.
export async function composePagesIntoFile(pages: PendingPage[]): Promise<File> {
  if (pages.length === 0) {
    throw new Error('선택된 페이지가 없습니다.');
  }

  if (pages.length === 1 && pages[0].kind === 'image') {
    return pages[0].file;
  }

  const outDoc = await PDFDocument.create();
  const sourceDocCache = new Map<File, PDFDocument>();

  for (const page of pages) {
    if (page.kind === 'pdf-page') {
      let sourceDoc = sourceDocCache.get(page.file);
      if (!sourceDoc) {
        sourceDoc = await PDFDocument.load(await page.file.arrayBuffer());
        sourceDocCache.set(page.file, sourceDoc);
      }
      const [copiedPage] = await outDoc.copyPages(sourceDoc, [page.pageIndex ?? 0]);
      outDoc.addPage(copiedPage);
    } else {
      const { bytes, width, height } = await rasterizeImageToJpeg(page.file);
      const embedded = await outDoc.embedJpg(bytes);
      const pdfPage = outDoc.addPage([width, height]);
      pdfPage.drawImage(embedded, { x: 0, y: 0, width, height });
    }
  }

  const bytes = await outDoc.save();
  return new File([bytes as unknown as BlobPart], 'combined.pdf', { type: 'application/pdf' });
}
