import { PDFDocument } from 'pdf-lib';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/supabase';
import { isPdfFile } from './storage';
import { detectContentBoxForImageUrl, type ContentBoxFraction } from './contentBox';
import { detectPdfPageContentBox } from './pdfContentBox';

export interface ExportSheetSource {
  id: string; // sheets.id
  title: string;
  fileUrl: string;
}

interface Stroke {
  color: string;
  width: number;
  points: [number, number][]; // 0~1로 정규화된 좌표
  isEraser?: boolean;
  isHighlighter?: boolean;
}

interface RenderedPage {
  jpegBytes: Uint8Array;
  width: number;
  height: number;
}

export interface RenderedSheet {
  title: string;
  pages: RenderedPage[];
}

interface ExportOptions {
  includeMarkup: boolean;
}

const HIGHLIGHTER_OPACITY = 0.4;
// 다운로드용 최종 해상도 상한(긴 변 기준, px). 화면 표시보다 넉넉히 잡아
// 인쇄/확대에도 무리 없는 수준으로 하되, 파일 용량이 과도해지지 않게 한다.
const MAX_RENDER_LONG_EDGE = 2200;
const JPEG_QUALITY = 0.92;

// 화면의 DrawingLayer가 그리는 필기(펜/형광펜/지우개)를 그대로 재현한다.
// 지우개는 destination-out으로 "같은 레이어 안의 이전 획"만 지워야 하므로,
// 반드시 별도의 투명 캔버스에 먼저 그린 뒤 결과만 원본 위에 합성해야 한다
// (원본 캔버스에 직접 그리면 지우개가 악보 내용까지 지워버린다).
function renderStrokesLayer(strokes: Stroke[], width: number, height: number, strokeScale: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  for (const stroke of strokes) {
    if (stroke.points.length < 2) continue;
    ctx.globalCompositeOperation = stroke.isEraser ? 'destination-out' : 'source-over';
    ctx.globalAlpha = stroke.isHighlighter ? HIGHLIGHTER_OPACITY : 1;
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = stroke.width * strokeScale;
    ctx.lineCap = stroke.isHighlighter ? 'square' : 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(stroke.points[0][0] * width, stroke.points[0][1] * height);
    for (const [x, y] of stroke.points.slice(1)) ctx.lineTo(x * width, y * height);
    ctx.stroke();
  }
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  return canvas;
}

// 필기 굵기(stroke.width)는 그려질 당시 화면(연주모드/미리보기)의 실제 표시
// 크기 기준 절대 픽셀 값으로 저장돼 있다. 다운로드는 그보다 훨씬 큰 해상도로
// 렌더링하므로, 그대로 쓰면 선이 머리카락처럼 가늘어 보인다. 기준 폭(REFERENCE)
// 대비 실제 출력 폭 비율만큼 굵기를 함께 키워 화면에서 본 굵기와 비슷하게 맞춘다.
const STROKE_WIDTH_REFERENCE_PX = 400;

async function loadUserStrokes(
  supabase: SupabaseClient<Database>,
  sheetId: string
): Promise<Stroke[]> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data } = await supabase
    .from('drawings')
    .select('coordinates')
    .eq('sheet_id', sheetId)
    .eq('user_id', user.id)
    .eq('page_number', 1)
    .maybeSingle();

  const parsed = data?.coordinates as unknown as { strokes?: Stroke[] } | null;
  return parsed?.strokes ?? [];
}

async function canvasToJpeg(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('이미지 변환에 실패했습니다.'))),
      'image/jpeg',
      JPEG_QUALITY
    );
  });
  return new Uint8Array(await blob.arrayBuffer());
}

function composeCroppedPage(
  source: HTMLCanvasElement | HTMLImageElement,
  sourceWidth: number,
  sourceHeight: number,
  box: ContentBoxFraction,
  strokes: Stroke[]
): { canvas: HTMLCanvasElement; strokeScale: number } {
  const sx = box.left * sourceWidth;
  const sy = box.top * sourceHeight;
  const sw = (box.right - box.left) * sourceWidth;
  const sh = (box.bottom - box.top) * sourceHeight;

  const longEdge = Math.max(sw, sh);
  const scale = Math.min(MAX_RENDER_LONG_EDGE / longEdge, 8);

  const outWidth = Math.max(1, Math.round(sw * scale));
  const outHeight = Math.max(1, Math.round(sh * scale));

  const canvas = document.createElement('canvas');
  canvas.width = outWidth;
  canvas.height = outHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) return { canvas, strokeScale: 1 };

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, outWidth, outHeight);
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, outWidth, outHeight);

  if (strokes.length > 0) {
    const strokeScale = outWidth / STROKE_WIDTH_REFERENCE_PX;
    const strokesLayer = renderStrokesLayer(strokes, outWidth, outHeight, strokeScale);
    ctx.drawImage(strokesLayer, 0, 0);
    return { canvas, strokeScale };
  }

  return { canvas, strokeScale: 1 };
}

async function renderImageSheet(url: string, strokes: Stroke[]): Promise<RenderedPage> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('이미지를 불러오지 못했습니다.'));
    image.src = url;
  });

  const box = await detectContentBoxForImageUrl(url);
  const { canvas } = composeCroppedPage(img, img.naturalWidth, img.naturalHeight, box, strokes);
  const jpegBytes = await canvasToJpeg(canvas);
  return { jpegBytes, width: canvas.width, height: canvas.height };
}

async function renderPdfSheet(url: string, strokes: Stroke[]): Promise<RenderedPage[]> {
  const pdfjsLib = await import('pdfjs-dist');
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

  const pdf = await pdfjsLib.getDocument(url).promise;
  const pages: RenderedPage[] = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const unscaledViewport = page.getViewport({ scale: 1 });
    const box = await detectPdfPageContentBox(page, unscaledViewport);

    // 원본 페이지를 크롭 영역이 넉넉한 해상도로 나오도록 한 번 더 렌더링한다.
    const contentWidthPt = unscaledViewport.width * (box.right - box.left);
    const contentHeightPt = unscaledViewport.height * (box.bottom - box.top);
    const longEdgePt = Math.max(contentWidthPt, contentHeightPt);
    const renderScale = Math.min(Math.max(MAX_RENDER_LONG_EDGE / longEdgePt, 1), 8);

    const fullViewport = page.getViewport({ scale: renderScale });
    const fullCanvas = document.createElement('canvas');
    fullCanvas.width = Math.max(1, Math.ceil(fullViewport.width));
    fullCanvas.height = Math.max(1, Math.ceil(fullViewport.height));
    const fullCtx = fullCanvas.getContext('2d');
    if (!fullCtx) continue;
    await page.render({ canvasContext: fullCtx, viewport: fullViewport }).promise;

    // drawings.page_number는 항상 1로 저장되므로(연주모드/미리보기와 동일하게),
    // 필기는 PDF의 첫 페이지에만 합성한다.
    const { canvas } = composeCroppedPage(
      fullCanvas,
      fullCanvas.width,
      fullCanvas.height,
      box,
      pageNumber === 1 ? strokes : []
    );
    const jpegBytes = await canvasToJpeg(canvas);
    pages.push({ jpegBytes, width: canvas.width, height: canvas.height });
  }

  return pages;
}

// 악보 하나를 여백 트리밍 + (선택 시) 필기 합성까지 마친 JPEG 페이지들로 렌더링한다.
export async function renderSheetForExport(
  supabase: SupabaseClient<Database>,
  source: ExportSheetSource,
  options: ExportOptions
): Promise<RenderedSheet> {
  const { data: signedData, error: signError } = await supabase.storage
    .from('sheets')
    .createSignedUrl(source.fileUrl, 600);

  if (signError || !signedData) {
    throw new Error(signError?.message ?? `${source.title}: 파일을 불러오지 못했습니다.`);
  }

  const strokes = options.includeMarkup ? await loadUserStrokes(supabase, source.id) : [];
  const url = signedData.signedUrl;

  const pages = isPdfFile(source.fileUrl)
    ? await renderPdfSheet(url, strokes)
    : [await renderImageSheet(url, strokes)];

  return { title: source.title, pages };
}

function buildPdfFromRenderedSheets(sheets: RenderedSheet[]): Promise<PDFDocument> {
  return (async () => {
    const doc = await PDFDocument.create();
    for (const sheet of sheets) {
      for (const page of sheet.pages) {
        const embedded = await doc.embedJpg(page.jpegBytes);
        const pdfPage = doc.addPage([page.width, page.height]);
        pdfPage.drawImage(embedded, { x: 0, y: 0, width: page.width, height: page.height });
      }
    }
    return doc;
  })();
}

export interface ExportManyResult {
  blob: Blob;
  skipped: string[];
}

export type ExportProgressCallback = (done: number, total: number) => void;

// 선택한 악보 여러 개를 페이지 순서대로 이어붙여 하나의 PDF로 만든다.
export async function exportSheetsAsMergedPdf(
  supabase: SupabaseClient<Database>,
  sources: ExportSheetSource[],
  options: ExportOptions,
  onProgress?: ExportProgressCallback
): Promise<ExportManyResult> {
  const rendered: RenderedSheet[] = [];
  const skipped: string[] = [];

  for (const source of sources) {
    try {
      rendered.push(await renderSheetForExport(supabase, source, options));
    } catch {
      skipped.push(source.title);
    }
    onProgress?.(rendered.length + skipped.length, sources.length);
  }

  if (rendered.length === 0) {
    throw new Error('악보를 하나도 포함하지 못했습니다.');
  }

  const doc = await buildPdfFromRenderedSheets(rendered);
  const pdfBytes = await doc.save();
  return { blob: new Blob([pdfBytes as unknown as BlobPart], { type: 'application/pdf' }), skipped };
}

export interface ExportedFile {
  title: string;
  blob: Blob;
}

export interface ExportSeparateResult {
  files: ExportedFile[];
  skipped: string[];
}

// 선택한 악보를 각각 독립된 PDF 파일로 만든다(개별 다운로드용).
export async function exportSheetsAsSeparatePdfs(
  supabase: SupabaseClient<Database>,
  sources: ExportSheetSource[],
  options: ExportOptions,
  onProgress?: ExportProgressCallback
): Promise<ExportSeparateResult> {
  const files: ExportedFile[] = [];
  const skipped: string[] = [];

  for (const source of sources) {
    try {
      const rendered = await renderSheetForExport(supabase, source, options);
      const doc = await buildPdfFromRenderedSheets([rendered]);
      const pdfBytes = await doc.save();
      files.push({
        title: source.title,
        blob: new Blob([pdfBytes as unknown as BlobPart], { type: 'application/pdf' }),
      });
    } catch {
      skipped.push(source.title);
    }
    onProgress?.(files.length + skipped.length, sources.length);
  }

  if (files.length === 0) {
    throw new Error('악보를 하나도 포함하지 못했습니다.');
  }

  return { files, skipped };
}
