// 이 기능(업로드 시 PDF 첫 페이지 썸네일 생성)이 추가되기 전에 올라간 PDF들은
// thumbnail_url이 비어 있어서 라이브러리 목록에 계속 "PDF" 아이콘만 표시된다.
// 이 스크립트는 그런 기존 PDF들을 한 번 찾아서 썸네일을 만들어 채워준다.
//
// 실행 전 준비:
//   1) npm install canvas   (Node에서 PDF를 렌더링하는 데 필요, 미리 빌드된 바이너리 사용)
//   2) .env.local 에 SUPABASE_SERVICE_ROLE_KEY 추가
//      - Supabase 대시보드 → 해당 프로젝트 → Project Settings → API → "service_role" 비밀 키
//      - 이 키는 RLS(행 단위 보안)를 무시하고 모든 팀의 sheets 테이블에 접근할 수 있으므로
//        절대 커밋하거나 클라이언트 코드에 노출하면 안 됨. .env.local은 이미 git에서 제외되어 있어야 함.
//   3) 실행: node scripts/backfillPdfThumbnails.mjs
//      (원하면 미리보기만: node scripts/backfillPdfThumbnails.mjs --dry-run)
//
// 한 번 돌리고 나면 남은 대상이 없어질 것이므로, 필요할 때 다시 실행해도
// 이미 thumbnail_url이 채워진 행은 건드리지 않는다(멱등).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { createCanvas, DOMMatrix } from 'canvas';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

const DRY_RUN = process.argv.includes('--dry-run');

// pdfjs의 Node/legacy 빌드가 내부적으로 브라우저 전역 객체(DOMMatrix)를 참조하는
// 부분이 있어 canvas 패키지가 제공하는 구현으로 채워준다.
globalThis.DOMMatrix = globalThis.DOMMatrix || DOMMatrix;

// 표준 폰트/CMap 데이터 경로 — 없으면 텍스트가 렌더링되지 않고 벡터 선만 보인다.
const pdfjsDistDir = path.dirname(fileURLToPath(import.meta.resolve('pdfjs-dist/package.json')));
const standardFontDataUrl = path.join(pdfjsDistDir, 'standard_fonts') + path.sep;
const cMapUrl = path.join(pdfjsDistDir, 'cmaps') + path.sep;

const THUMB_MAX_EDGE = 240;
const THUMB_JPEG_QUALITY = 0.7;
const BUCKET = 'sheets';

function loadEnvLocal() {
  const envPath = path.join(projectRoot, '.env.local');
  const env = {};
  if (!fs.existsSync(envPath)) return env;

  const content = fs.readFileSync(envPath, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

function buildThumbnailPath(teamId) {
  return `${teamId}/${crypto.randomUUID()}_thumb.jpg`;
}

async function renderFirstPageToJpeg(pdfBytes) {
  const pdf = await pdfjsLib.getDocument({
    data: pdfBytes,
    standardFontDataUrl,
    cMapUrl,
    cMapPacked: true,
    isEvalSupported: false,
  }).promise;

  try {
    const page = await pdf.getPage(1);
    const unscaledViewport = page.getViewport({ scale: 1 });
    const scale = THUMB_MAX_EDGE / Math.max(unscaledViewport.width, unscaledViewport.height);
    const viewport = page.getViewport({ scale });

    const canvas = createCanvas(Math.max(1, Math.round(viewport.width)), Math.max(1, Math.round(viewport.height)));
    const ctx = canvas.getContext('2d');

    await page.render({ canvasContext: ctx, viewport }).promise;

    return canvas.toBuffer('image/jpeg', { quality: THUMB_JPEG_QUALITY });
  } finally {
    await pdf.destroy();
  }
}

async function main() {
  const env = loadEnvLocal();
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl) {
    console.error('.env.local 에서 NEXT_PUBLIC_SUPABASE_URL 을 찾을 수 없습니다.');
    process.exit(1);
  }
  if (!serviceRoleKey) {
    console.error(
      '.env.local 에 SUPABASE_SERVICE_ROLE_KEY 가 없습니다.\n' +
        'Supabase 대시보드 → Project Settings → API 에서 "service_role" 비밀 키를 복사해\n' +
        '.env.local 에 SUPABASE_SERVICE_ROLE_KEY=... 형태로 추가한 뒤 다시 실행해주세요.\n' +
        '(이 키는 절대 커밋하거나 클라이언트 코드에서 사용하면 안 됩니다.)'
    );
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  console.log(DRY_RUN ? '[dry-run 모드] 실제로 업로드/업데이트하지 않고 대상만 확인합니다.\n' : '');

  const { data: sheets, error } = await supabase
    .from('sheets')
    .select('id, team_id, title, file_url, thumbnail_url')
    .is('thumbnail_url', null)
    .not('file_url', 'is', null);

  if (error) {
    console.error('sheets 테이블 조회 실패:', error.message);
    process.exit(1);
  }

  const targets = (sheets ?? []).filter((sheet) => sheet.file_url.toLowerCase().endsWith('.pdf'));

  console.log(`대상: 썸네일이 없는 PDF ${targets.length}개 (전체 조회 ${sheets?.length ?? 0}개 중)\n`);

  if (targets.length === 0) {
    console.log('처리할 항목이 없습니다.');
    return;
  }

  let succeeded = 0;
  let failed = 0;

  for (const [i, sheet] of targets.entries()) {
    const label = `[${i + 1}/${targets.length}] "${sheet.title}" (${sheet.file_url})`;
    try {
      const { data: fileBlob, error: downloadError } = await supabase.storage
        .from(BUCKET)
        .download(sheet.file_url);

      if (downloadError || !fileBlob) {
        throw new Error(downloadError?.message ?? '원본 파일 다운로드 실패');
      }

      const pdfBytes = new Uint8Array(await fileBlob.arrayBuffer());
      const jpegBuffer = await renderFirstPageToJpeg(pdfBytes);

      if (DRY_RUN) {
        console.log(`${label} → 렌더링 성공 (dry-run이라 업로드는 건너뜀)`);
        succeeded++;
        continue;
      }

      const thumbnailPath = buildThumbnailPath(sheet.team_id);
      const { error: uploadError } = await supabase.storage
        .from(BUCKET)
        .upload(thumbnailPath, jpegBuffer, { contentType: 'image/jpeg' });

      if (uploadError) {
        throw new Error(`썸네일 업로드 실패: ${uploadError.message}`);
      }

      const { error: updateError } = await supabase
        .from('sheets')
        .update({ thumbnail_url: thumbnailPath })
        .eq('id', sheet.id);

      if (updateError) {
        throw new Error(`DB 업데이트 실패: ${updateError.message}`);
      }

      console.log(`${label} → 완료`);
      succeeded++;
    } catch (err) {
      console.error(`${label} → 실패: ${err instanceof Error ? err.message : err}`);
      failed++;
    }
  }

  console.log(`\n완료: 성공 ${succeeded}개, 실패 ${failed}개`);
}

main().catch((err) => {
  console.error('스크립트 실행 중 오류:', err);
  process.exit(1);
});
