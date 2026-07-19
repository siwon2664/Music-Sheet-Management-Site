import type { PDFPageProxy } from 'pdfjs-dist';
import { detectContentBox, FULL_CONTENT_BOX, type ContentBoxFraction } from './contentBox';

const ANALYSIS_MAX_DIMENSION = 400;

// PDF 페이지를 저해상도로 한 번 그려 여백을 제외한 실제 내용의 경계 상자를 감지한다.
// PdfPageViewer(화면 표시)와 exportSheets(다운로드) 양쪽에서 공통으로 쓴다.
export async function detectPdfPageContentBox(
  page: PDFPageProxy,
  unscaledViewport: { width: number; height: number }
): Promise<ContentBoxFraction> {
  const analysisScale = Math.min(1, ANALYSIS_MAX_DIMENSION / unscaledViewport.width);
  const analysisViewport = page.getViewport({ scale: analysisScale });

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(analysisViewport.width));
  canvas.height = Math.max(1, Math.ceil(analysisViewport.height));
  const ctx = canvas.getContext('2d');
  if (!ctx) return FULL_CONTENT_BOX;

  await page.render({ canvasContext: ctx, viewport: analysisViewport }).promise;
  return detectContentBox(ctx, canvas.width, canvas.height);
}
