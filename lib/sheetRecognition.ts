// 업로드 중인 악보 첫 페이지에서 제목과 조성(Key)을 "자동 인식"해 제안한다.
//
// 파이프라인:
//  1) 페이지를 OCR에 적합한 고해상도 캔버스로 렌더링한다 (업로드 미리보기용
//     썸네일은 최대 220px라 OCR엔 너무 작다).
//  2) staffBandDetection으로 오선 시스템 위치를 찾는다.
//  3) 첫 시스템보다 위쪽(헤더)만 잘라 OCR → 제목 추정.
//  4) 각 시스템 바로 위 띠만 잘라 OCR → 코드 기호만 추출 → chordKey로 조성 추정.
//
// 정확도는 악보 화질/형식에 따라 편차가 크다. 이 결과는 항상 "제안"이고,
// 호출부(UploadSheetModal)에서 사용자가 확인·수정할 수 있어야 한다.
import type { PendingPage } from './pageCompose';
import { detectStaffSystems, cropChordBand, cropHeaderRegion, type StaffSystem } from './staffBandDetection';
import { extractChordsFromText, estimateKeyFromChords } from './chordKey';

const RECOGNITION_MAX_EDGE = 1600;

async function loadPdfjs() {
  const pdfjsLib = await import('pdfjs-dist');
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;
  return pdfjsLib;
}

// 인식용으로 페이지 하나를 고해상도 캔버스에 다시 렌더링한다.
async function renderPageForRecognition(page: PendingPage): Promise<HTMLCanvasElement> {
  if (page.kind === 'image') {
    const bitmap = await createImageBitmap(page.file);
    try {
      const scale = Math.min(1, RECOGNITION_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      return canvas;
    } finally {
      bitmap.close();
    }
  }

  const pdfjsLib = await loadPdfjs();
  const pdf = await pdfjsLib.getDocument({ data: await page.file.arrayBuffer() }).promise;
  const pdfPage = await pdf.getPage((page.pageIndex ?? 0) + 1);
  const unscaledViewport = pdfPage.getViewport({ scale: 1 });
  const scale = RECOGNITION_MAX_EDGE / Math.max(unscaledViewport.width, unscaledViewport.height);
  const viewport = pdfPage.getViewport({ scale });

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(viewport.width));
  canvas.height = Math.max(1, Math.round(viewport.height));
  const ctx = canvas.getContext('2d');
  if (ctx) await pdfPage.render({ canvasContext: ctx, viewport }).promise;
  return canvas;
}

interface HeaderLine {
  text: string;
  height: number; // bbox 높이(px) — 폰트 크기의 대략적인 대용치
  top: number;
}

// Tesseract 결과의 blocks(block > paragraph > line 계층)를 줄 단위로 펼친다.
// 정확한 타입 대신 필요한 모양(paragraphs/lines/bbox)만 구조적으로 요구해서
// tesseract.js의 내부 타입 이름에 얽매이지 않게 했다.
function flattenLines<
  L extends { text: string; bbox: { y0: number; y1: number } },
  P extends { lines: L[] },
  B extends { paragraphs: P[] },
>(blocks: B[] | null): HeaderLine[] {
  if (!blocks) return [];
  const lines: HeaderLine[] = [];
  for (const block of blocks) {
    for (const paragraph of block.paragraphs) {
      for (const line of paragraph.lines) {
        const text = line.text.trim();
        if (!text) continue;
        lines.push({ text, height: line.bbox.y1 - line.bbox.y0, top: line.bbox.y0 });
      }
    }
  }
  return lines;
}

// 헤더 영역에서 제목으로 보이는 줄을 고른다. 글자 수가 아니라 "줄 높이(폰트
// 크기)"로 판단한다 — 처음엔 한글/영문 글자 수가 많은 줄을 골랐는데, 실제
// 샘플("Golden")에서 부제("(애니메이션 'KPop Demon Hunters')")나 작사/작곡가
// 줄이 원제보다 글자 수가 많아서 엉뚱한 줄이 뽑히는 게 확인됐다. 제목은
// 거의 항상 헤더에서 가장 큰 폰트로 인쇄되므로 줄 높이가 훨씬 신뢰도 높은
// 신호다. 템포 표기·버전/편곡자 태그·URL(워터마크)처럼 흔한 잡음은 먼저
// 제외한다.
function guessTitleFromHeaderLines(lines: HeaderLine[]): string | null {
  const isNoise = (text: string) =>
    /^[\d.\s=♩:♪]+$/.test(text) || // 템포 표기 (예: "♩=140")
    /^arr[.,]?\s/i.test(text) || // "arr. 방길환"
    /_?ver\.?$/i.test(text) || // "FIA_ver" 같은 버전 태그
    /^(https?:\/\/|www\.)/i.test(text) || // 워터마크 URL
    text.replace(/[^\p{L}\p{N}]/gu, '').length < 2; // 글자/숫자가 1개 이하인 잡음(오인식된 기호 등)

  const candidates = lines.filter((l) => !isNoise(l.text));
  if (candidates.length === 0) return null;

  // 높이가 가장 큰 줄을 고르되, 높이가 비슷하면(5px 이내) 더 위쪽 줄을
  // 우선한다 — 제목은 보통 헤더에서 가장 먼저 나온다.
  const best = candidates.reduce((a, b) => {
    if (Math.abs(b.height - a.height) <= 5) return a.top <= b.top ? a : b;
    return b.height > a.height ? b : a;
  });
  return best.text;
}

export interface RecognitionResult {
  title: string | null;
  key: string | null;
  keyConfidence: number;
  chordsFound: string[];
  systemsDetected: number;
}

export async function recognizeSheet(page: PendingPage): Promise<RecognitionResult> {
  const canvas = await renderPageForRecognition(page);
  const ctx = canvas.getContext('2d');
  const imageData = ctx?.getImageData(0, 0, canvas.width, canvas.height) ?? null;

  const systems: StaffSystem[] = imageData ? detectStaffSystems(imageData) : [];
  const firstSystem = systems[0] ?? null;

  const { createWorker, PSM } = await import('tesseract.js');
  const worker = await createWorker('kor+eng');

  let title: string | null = null;
  const chordWords: string[] = [];

  try {
    const headerCanvas = cropHeaderRegion(canvas, canvas.width, canvas.height, firstSystem);
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_COLUMN });
    // blocks:true를 줘야 줄 단위 bbox(높이)가 나온다 — 기본값은 text만 준다.
    const headerResult = await worker.recognize(headerCanvas, {}, { blocks: true });
    title = guessTitleFromHeaderLines(flattenLines(headerResult.data.blocks));

    if (systems.length > 0) {
      // 코드 기호는 영문자/숫자/기호뿐이라 한글 사전이 없는 eng 단일 언어가
      // 더 정확하고 빠르다. PSM은 "띄엄띄엄 흩어진 텍스트"용인 SPARSE_TEXT를
      // 처음 썼는데, 실제 샘플로 비교해보니 SINGLE_BLOCK이 코드 줄을 훨씬
      // 안정적으로 통짜 텍스트로 읽어냈다(코드 아래 잘려 들어간 잇단음표
      // 숫자/빔 잔상은 잡음으로 같이 잡히지만, 코드 정규식이 알아서 걸러준다).
      await worker.reinitialize('eng');
      await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK });

      for (const system of systems) {
        const band = cropChordBand(canvas, canvas.width, system);
        const bandResult = await worker.recognize(band);
        chordWords.push(...bandResult.data.text.split(/\s+/).filter(Boolean));
      }
    }
  } finally {
    await worker.terminate();
  }

  const parsedChords = extractChordsFromText(chordWords.join(' '));
  const keyEstimate = estimateKeyFromChords(parsedChords);

  return {
    title,
    key: keyEstimate?.key ?? null,
    keyConfidence: keyEstimate?.confidence ?? 0,
    chordsFound: parsedChords.map((c) => c.raw),
    systemsDetected: systems.length,
  };
}
