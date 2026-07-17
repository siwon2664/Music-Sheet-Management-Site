// 원본 사진(특히 스마트폰 카메라)은 수 MB에 달해 업로드/목록 조회를 느리게 만든다.
// 캔버스로 리사이즈해 "표시용" 이미지와 "목록 썸네일" 이미지를 따로 만들어 올린다.

export function isResizableImage(file: File): boolean {
  return file.type.startsWith('image/') && file.type !== 'image/svg+xml';
}

async function loadBitmap(file: File): Promise<ImageBitmap> {
  return createImageBitmap(file);
}

function resizedDimensions(width: number, height: number, maxDimension: number) {
  const scale = Math.min(1, maxDimension / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

async function drawResized(bitmap: ImageBitmap, maxDimension: number, quality: number): Promise<Blob> {
  const { width, height } = resizedDimensions(bitmap.width, bitmap.height, maxDimension);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas context를 생성할 수 없습니다.');

  ctx.drawImage(bitmap, 0, 0, width, height);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('이미지 변환에 실패했습니다.'))),
      'image/jpeg',
      quality
    );
  });
}

function blobToFile(blob: Blob, name: string): File {
  return new File([blob], name, { type: blob.type });
}

// 원본을 대체할 표시용 이미지: 화질은 유지하되 과도한 해상도/용량만 줄인다.
export async function createDisplayImage(file: File, baseName: string): Promise<File> {
  const bitmap = await loadBitmap(file);
  try {
    const blob = await drawResized(bitmap, 2000, 0.85);
    return blobToFile(blob, `${baseName}.jpg`);
  } finally {
    bitmap.close();
  }
}

// 목록에서 40px 남짓으로 표시되는 썸네일: 매우 작게 만들어 조회 속도를 확보한다.
export async function createThumbnailImage(file: File, baseName: string): Promise<File> {
  const bitmap = await loadBitmap(file);
  try {
    const blob = await drawResized(bitmap, 240, 0.7);
    return blobToFile(blob, `${baseName}_thumb.jpg`);
  } finally {
    bitmap.close();
  }
}
