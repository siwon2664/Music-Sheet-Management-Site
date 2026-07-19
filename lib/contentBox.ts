// 스캔한 악보 이미지/PDF는 파일마다 흰 여백의 크기가 제각각이라, 여백까지
// 포함한 원본 비율 그대로 화면에 꽉 채우면 파일마다 실제 악보 내용의
// 표시 크기가 들쭉날쭉해진다. 캔버스에 그려진 픽셀을 스캔해 "흰 배경이
// 아닌" 내용의 경계 상자를 찾아내고, 그 상자를 기준으로 화면을 채우게
// 하면 여백 크기와 무관하게 항상 악보 내용이 최대 크기로 보인다.

export interface ContentBoxFraction {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export const FULL_CONTENT_BOX: ContentBoxFraction = { left: 0, top: 0, right: 1, bottom: 1 };

const BRIGHTNESS_THRESHOLD = 250; // 이보다 밝으면(흰 배경에 가까우면) 내용으로 안 침
const ALPHA_THRESHOLD = 10;
const MAX_SAMPLES_PER_AXIS = 300;
const MIN_CONTENT_FRACTION = 0.05; // 감지 결과가 이보다 작으면 오탐으로 보고 원본을 그대로 쓴다
const EDGE_PADDING_FRACTION = 0.015; // 내용 영역 크기에 비례한 여유
const MIN_ABSOLUTE_PADDING_FRACTION = 0.02; // 원본 전체 크기 기준 최소 여유(많이 잘라낼 때도 줄어들지 않음)

export function detectContentBox(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number
): ContentBoxFraction {
  if (width < 4 || height < 4) return FULL_CONTENT_BOX;

  const { data } = ctx.getImageData(0, 0, width, height);

  const stepX = Math.max(1, Math.floor(width / MAX_SAMPLES_PER_AXIS));
  const stepY = Math.max(1, Math.floor(height / MAX_SAMPLES_PER_AXIS));

  function isContentPixel(x: number, y: number): boolean {
    const i = (y * width + x) * 4;
    const a = data[i + 3];
    if (a < ALPHA_THRESHOLD) return false;
    return data[i] < BRIGHTNESS_THRESHOLD || data[i + 1] < BRIGHTNESS_THRESHOLD || data[i + 2] < BRIGHTNESS_THRESHOLD;
  }

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y += stepY) {
    for (let x = 0; x < width; x += stepX) {
      if (!isContentPixel(x, y)) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  if (maxX < minX || maxY < minY) return FULL_CONTENT_BOX;

  // 샘플링 간격만큼 경계가 안쪽으로 당겨져 있을 수 있으니 한 스텝 여유를 둔다.
  minX = Math.max(0, minX - stepX);
  minY = Math.max(0, minY - stepY);
  maxX = Math.min(width - 1, maxX + stepX);
  maxY = Math.min(height - 1, maxY + stepY);

  const box: ContentBoxFraction = {
    left: minX / width,
    top: minY / height,
    right: (maxX + 1) / width,
    bottom: (maxY + 1) / height,
  };

  const boxWidth = box.right - box.left;
  const boxHeight = box.bottom - box.top;
  if (boxWidth < MIN_CONTENT_FRACTION || boxHeight < MIN_CONTENT_FRACTION) return FULL_CONTENT_BOX;

  // 여백을 많이 잘라낼수록(내용 영역이 작을수록) 상대 비례 여유는 같이 작아지므로,
  // 원본 전체 크기 기준의 최소 여유를 함께 보장해 구석의 얇거나 흐린 내용이
  // 잘리지 않도록 한다.
  const padX = Math.max(boxWidth * EDGE_PADDING_FRACTION, MIN_ABSOLUTE_PADDING_FRACTION);
  const padY = Math.max(boxHeight * EDGE_PADDING_FRACTION, MIN_ABSOLUTE_PADDING_FRACTION);

  return {
    left: Math.max(0, box.left - padX),
    top: Math.max(0, box.top - padY),
    right: Math.min(1, box.right + padX),
    bottom: Math.min(1, box.bottom + padY),
  };
}

const ANALYSIS_MAX_DIMENSION = 400;

// 이미지 URL에서 여백 경계 상자를 감지한다. 픽셀을 읽으려면(getImageData)
// 이미지를 익명 CORS로 새로 불러와야 하는데, 서버가 CORS를 지원하지 않는
// 환경도 있을 수 있어 실패하면 조용히 원본 그대로(FULL_CONTENT_BOX)를 반환한다 —
// 이 감지가 실패해도 이미지 표시/다운로드 자체는 항상 정상 동작해야 하기 때문.
export async function detectContentBoxForImageUrl(url: string): Promise<ContentBoxFraction> {
  return new Promise((resolve) => {
    const probe = new Image();
    probe.crossOrigin = 'anonymous';
    probe.onload = () => {
      try {
        const analysisScale = Math.min(1, ANALYSIS_MAX_DIMENSION / probe.naturalWidth);
        const aw = Math.max(1, Math.round(probe.naturalWidth * analysisScale));
        const ah = Math.max(1, Math.round(probe.naturalHeight * analysisScale));
        const canvas = document.createElement('canvas');
        canvas.width = aw;
        canvas.height = ah;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(FULL_CONTENT_BOX);
          return;
        }
        ctx.drawImage(probe, 0, 0, aw, ah);
        resolve(detectContentBox(ctx, aw, ah));
      } catch {
        resolve(FULL_CONTENT_BOX);
      }
    };
    probe.onerror = () => resolve(FULL_CONTENT_BOX);
    probe.src = url;
  });
}
