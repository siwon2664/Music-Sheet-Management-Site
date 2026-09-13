// 오선(5줄) 시스템의 위치를 픽셀 밝기 분석만으로 찾아낸다. 진짜 광학악보인식
// (OMR)처럼 음표를 전사하지는 않고, "코드 기호가 적힌 띠"와 "제목이 적힌
// 헤더 영역"을 오려내기 위한 좌표만 찾는 훨씬 좁은 문제로 한정했다.
//
// 원리: 각 행(row)의 "가로 방향 어두운 픽셀 비율"을 계산하면, 오선이
// 지나가는 행에서 뚜렷한 피크가 나타난다 — 오선은 페이지 폭 대부분을
// 가로지르는 얇고 진한 선이라 다른 요소(음표, 가사, 코드 글자)보다 어두운
// 비율이 훨씬 높다. 그 피크들을 세로 위치가 가까운 것끼리 묶으면 시스템
// (5줄 묶음) 단위로 클러스터링할 수 있고, 각 클러스터의 최상단 행이 "그
// 시스템의 첫 줄" y좌표가 된다. 코드 기호는 보통 그 줄 바로 위쪽에 인쇄돼
// 있으므로, 그 좌표를 기준으로 위쪽 띠만 잘라내면 음표/빔과 섞이지 않은
// 상태로 OCR에 넘길 수 있다.
//
// 스캔 화질이 낮거나 워터마크가 겹쳐 있으면 일부 오선이 약하게 잡히거나
// 아예 안 잡힐 수 있다 — 그래서 이 결과는 항상 "최선의 추정"이고, 실패해도
// (시스템을 하나도 못 찾아도) 업로드 자체는 막지 않고 그냥 자동 인식만
// 건너뛰도록 호출부에서 처리해야 한다.

export interface StaffSystem {
  topY: number; // 이 시스템의 첫 번째 오선 y좌표
  lineSpacing: number; // 추정 오선 간격(px) — 해상도에 비례해 띠 높이를 정하는 데 쓴다
}

const DARK_LUMINANCE_THRESHOLD = 180;
const ROW_DARK_RATIO_THRESHOLD = 0.55; // 이 이상이면 "오선일 가능성이 높은 행"
const MERGE_GAP_PX = 25; // 이 이하 간격이면 같은 시스템(같은 오선 묶음)으로 본다
const DEFAULT_LINE_SPACING = 6;

function computeRowDarkRatios(imageData: ImageData): Float64Array {
  const { data, width, height } = imageData;
  const ratios = new Float64Array(height);
  for (let y = 0; y < height; y++) {
    let darkCount = 0;
    const rowOffset = y * width * 4;
    for (let x = 0; x < width; x++) {
      const i = rowOffset + x * 4;
      const luminance = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
      if (luminance < DARK_LUMINANCE_THRESHOLD) darkCount++;
    }
    ratios[y] = darkCount / width;
  }
  return ratios;
}

export function detectStaffSystems(imageData: ImageData): StaffSystem[] {
  const ratios = computeRowDarkRatios(imageData);

  const peakRows: number[] = [];
  for (let y = 0; y < ratios.length; y++) {
    if (ratios[y] >= ROW_DARK_RATIO_THRESHOLD) peakRows.push(y);
  }
  if (peakRows.length === 0) return [];

  const clusters: number[][] = [[peakRows[0]]];
  for (const y of peakRows.slice(1)) {
    const cluster = clusters[clusters.length - 1];
    if (y - cluster[cluster.length - 1] <= MERGE_GAP_PX) cluster.push(y);
    else clusters.push([y]);
  }

  return clusters.map((rows) => {
    const topY = Math.min(...rows);
    // 클러스터 내부에서 "오선 간격다운" 작은 간격들만 평균 내 오선 간격을 추정한다.
    const diffs = rows.slice(1).map((y, i) => y - rows[i]).filter((d) => d > 0 && d <= 10);
    const lineSpacing = diffs.length > 0 ? diffs.reduce((a, b) => a + b, 0) / diffs.length : DEFAULT_LINE_SPACING;
    return { topY, lineSpacing };
  });
}

// 코드 띠를 OCR에 넘기기 전 이 높이(px)까지 확대한다. 원본 페이지가
// 작으면(예: 720px 너비 스캔본) 오선 간격이 5~6px밖에 안 돼서 잘라낸 띠가
// 20~30px 높이로 나오는데, 이 크기론 Tesseract가 "C", "G" 같은 짧은
// 코드조차 제대로 못 읽는다는 게 실제 샘플로 확인됐다 — 3배 확대(약
// 100px)만 해도 인식률이 확 좋아졌다. 여유 있게 200px를 목표로 잡는다.
const CHORD_BAND_TARGET_HEIGHT = 200;
const MAX_UPSCALE = 8; // 이미 아주 작은 크롭에서 과도하게 확대해 성능/화질 문제가 생기지 않도록 상한을 둔다.

// 오선 시스템 바로 위쪽 "코드 기호가 적힌 띠"를 잘라낸다. 띠 높이/여백을
// 오선 간격의 배수로 잡아 해상도가 달라져도 비율이 유지되게 하고, 잘라낸
// 뒤에는 OCR이 읽기 좋은 크기로 확대한다.
export function cropChordBand(
  source: CanvasImageSource,
  canvasWidth: number,
  system: StaffSystem,
  bandHeightMultiplier = 6,
  gapMultiplier = 0.5
): HTMLCanvasElement {
  const bandHeight = Math.max(20, Math.round(system.lineSpacing * bandHeightMultiplier));
  const gap = Math.round(system.lineSpacing * gapMultiplier);
  const y2 = Math.max(1, system.topY - gap);
  const y1 = Math.max(0, y2 - bandHeight);
  const cropHeight = Math.max(1, y2 - y1);

  const scale = Math.min(MAX_UPSCALE, Math.max(1, CHORD_BAND_TARGET_HEIGHT / cropHeight));

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(canvasWidth * scale);
  canvas.height = Math.round(cropHeight * scale);
  const ctx = canvas.getContext('2d');
  if (ctx) {
    // 최근접 보간(nearest-neighbor)으로 확대하면 글자가 계단처럼 깨져서
    // OCR에 오히려 불리하다 — 부드러운 고품질 보간을 켠다(실제 샘플 검증
    // 때 Python PIL의 LANCZOS로 확대한 것과 같은 효과를 노린 것).
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, 0, y1, canvasWidth, cropHeight, 0, 0, canvas.width, canvas.height);
  }
  return canvas;
}

// 첫 오선 시스템보다 위쪽(제목/템포/편곡자 정보가 있는 헤더 영역)을 잘라낸다.
// 시스템을 하나도 못 찾았으면(예외적인 레이아웃) 페이지 상단 20%를 대신 쓴다.
export function cropHeaderRegion(
  source: CanvasImageSource,
  canvasWidth: number,
  imageHeight: number,
  firstSystem: StaffSystem | null
): HTMLCanvasElement {
  const bottom = firstSystem
    ? Math.max(1, firstSystem.topY - Math.round(firstSystem.lineSpacing * 0.5))
    : Math.round(imageHeight * 0.2);

  const canvas = document.createElement('canvas');
  canvas.width = canvasWidth;
  canvas.height = Math.max(1, Math.min(bottom, imageHeight));
  const ctx = canvas.getContext('2d');
  if (ctx) ctx.drawImage(source, 0, 0, canvasWidth, canvas.height, 0, 0, canvasWidth, canvas.height);
  return canvas;
}
