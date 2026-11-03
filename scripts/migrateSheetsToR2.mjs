// 기존 Supabase Storage('sheets' 버킷)에 남아있는 악보 파일들을 Cloudflare R2로 옮긴다.
// 행마다: Supabase에서 다운로드 → R2에 'r2/{기존 경로}'로 업로드 → sheets.file_url/
// thumbnail_url을 새 경로로 갱신 → Supabase 원본 삭제.
//
// 주의: Supabase Storage가 용량 초과로 restricted 상태면 다운로드 자체가 실패한다.
// 대시보드에서 정리하거나 플랜을 올려 접근을 복구한 뒤에 실행해야 한다.
//
// 실행 전 준비: .env.local 에 SUPABASE_SERVICE_ROLE_KEY 와 R2_* 값 4개.
// 사용법:
//   node scripts/migrateSheetsToR2.mjs            (대상만 출력)
//   node scripts/migrateSheetsToR2.mjs --run      (실제 이전)
//
// 이미 'r2/'로 시작하는 경로는 건너뛰므로 여러 번 실행해도 안전하다(멱등).
//
// 용량을 비우려고 대시보드에서 내려받은 뒤 Supabase에서 지운 파일은
// migration-staging/{기존 경로} 에 두면(예: migration-staging/{teamId}/{uuid}.pdf)
// Supabase 대신 그 로컬 파일을 R2로 올린다.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

const RUN = process.argv.includes('--run');
const BUCKET = 'sheets';
const R2_PREFIX = 'r2/';
const STAGING_DIR = path.join(projectRoot, 'migration-staging');

function loadEnvLocal() {
  const envPath = path.join(projectRoot, '.env.local');
  const env = {};
  if (!fs.existsSync(envPath)) return env;

  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
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

function guessContentType(p) {
  const ext = p.toLowerCase().split('.').pop();
  if (ext === 'pdf') return 'application/pdf';
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  return 'image/jpeg';
}

async function main() {
  const env = loadEnvLocal();
  const required = [
    'NEXT_PUBLIC_SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'R2_ACCOUNT_ID',
    'R2_ACCESS_KEY_ID',
    'R2_SECRET_ACCESS_KEY',
    'R2_BUCKET_NAME',
  ];
  const missing = required.filter((k) => !env[k]);
  if (missing.length > 0) {
    console.error(`.env.local 에 다음 값이 없습니다: ${missing.join(', ')}`);
    process.exit(1);
  }

  const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  const r2 = new S3Client({
    region: 'auto',
    endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY },
  });

  const { data: sheets, error } = await supabase.from('sheets').select('id, title, file_url, thumbnail_url');
  if (error) {
    console.error('sheets 테이블 조회 실패:', error.message);
    process.exit(1);
  }

  const isLegacy = (p) => !!p && !p.startsWith(R2_PREFIX);
  const targets = (sheets ?? []).filter((s) => isLegacy(s.file_url) || isLegacy(s.thumbnail_url));
  console.log(`이전 대상: ${targets.length}개 악보\n`);

  if (!RUN) {
    for (const s of targets.slice(0, 50)) console.log(`  ${s.title}`);
    if (targets.length > 50) console.log(`  ... 외 ${targets.length - 50}개`);
    console.log('\n[미리보기] 실제로 옮기려면 --run 옵션을 붙여 다시 실행하세요.');
    return;
  }

  let migrated = 0;
  let failed = 0;

  for (const sheet of targets) {
    try {
      const update = {};
      const toRemove = [];

      for (const column of ['file_url', 'thumbnail_url']) {
        const oldPath = sheet[column];
        if (!isLegacy(oldPath)) continue;

        const stagedFile = path.join(STAGING_DIR, ...oldPath.split('/'));
        let body;
        if (fs.existsSync(stagedFile)) {
          body = fs.readFileSync(stagedFile);
        } else {
          const { data: blob, error: downloadError } = await supabase.storage.from(BUCKET).download(oldPath);
          if (downloadError || !blob) throw new Error(`다운로드 실패(${oldPath}): ${downloadError?.message}`);
          body = Buffer.from(await blob.arrayBuffer());
        }

        const newPath = `${R2_PREFIX}${oldPath}`;
        await r2.send(
          new PutObjectCommand({
            Bucket: env.R2_BUCKET_NAME,
            Key: newPath,
            Body: body,
            ContentType: guessContentType(oldPath),
          })
        );

        update[column] = newPath;
        toRemove.push(oldPath);
      }

      const { error: updateError } = await supabase.from('sheets').update(update).eq('id', sheet.id);
      if (updateError) throw new Error(`DB 갱신 실패: ${updateError.message}`);

      // DB가 새 경로를 가리키게 된 뒤에만 원본을 지운다 — 중간에 실패해도 파일이 사라지지 않게.
      await supabase.storage.from(BUCKET).remove(toRemove);
      migrated++;
      console.log(`  ✓ ${sheet.title}`);
    } catch (err) {
      failed++;
      console.error(`  ✗ ${sheet.title}: ${err.message}`);
    }
  }

  console.log(`\n완료: ${migrated}개 이전, ${failed}개 실패.`);
}

main();
