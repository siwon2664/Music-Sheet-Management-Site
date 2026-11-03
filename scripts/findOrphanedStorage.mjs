// 파일 삭제가 실패했거나, 업로드 후 sheets 행을 만들지 못하면 저장소에 파일만 남는다.
// 이 스크립트는 Supabase 'sheets' 버킷과 R2의 모든 객체를 나열하고, sheets 테이블의
// file_url/thumbnail_url에 더 이상 참조되지 않는 "고아 파일"을 찾아
// 용량과 목록을 보여준다. 기본은 dry-run이며 --delete를 줘야 실제로 지운다.
// R2는 업로드 후 행이 만들어지기 전일 수 있으므로 1시간이 안 된 객체는 제외한다.
//
// 실행 전 준비:
//   .env.local 에 SUPABASE_SERVICE_ROLE_KEY 와 R2_* 값 4개 필요
//
// 사용법:
//   node scripts/findOrphanedStorage.mjs            (조회만, 목록/용량 출력)
//   node scripts/findOrphanedStorage.mjs --delete    (고아 파일 실제 삭제)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { DeleteObjectsCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

const DELETE = process.argv.includes('--delete');
const BUCKET = 'sheets';
const R2_MIN_AGE_MS = 60 * 60 * 1000;

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

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = -1;
  do {
    value /= 1024;
    unitIndex++;
  } while (value >= 1024 && unitIndex < units.length - 1);
  return `${value.toFixed(2)} ${units[unitIndex]}`;
}

// storage.list()는 폴더 단위로만 나열하므로, 먼저 최상위(team_id) 폴더들을 구한 뒤
// 각 폴더 안의 파일들을 다시 나열해 전체 경로 목록을 만든다.
async function listAllObjects(supabase) {
  const all = [];

  const { data: topLevel, error: topError } = await supabase.storage.from(BUCKET).list('', {
    limit: 1000,
  });
  if (topError) throw new Error(`버킷 최상위 목록 조회 실패: ${topError.message}`);

  for (const entry of topLevel ?? []) {
    // id가 없으면 폴더(= team_id)로 간주한다. 실제 파일이면 id가 존재한다.
    if (entry.id) {
      all.push({ name: entry.name, size: entry.metadata?.size ?? 0 });
      continue;
    }

    let offset = 0;
    const limit = 1000;
    for (;;) {
      const { data: files, error: filesError } = await supabase.storage
        .from(BUCKET)
        .list(entry.name, { limit, offset });
      if (filesError) throw new Error(`"${entry.name}" 폴더 목록 조회 실패: ${filesError.message}`);
      if (!files || files.length === 0) break;

      for (const file of files) {
        all.push({ name: `${entry.name}/${file.name}`, size: file.metadata?.size ?? 0 });
      }

      if (files.length < limit) break;
      offset += limit;
    }
  }

  return all;
}

async function listR2Objects(r2, bucket) {
  const all = [];
  let token;
  do {
    const page = await r2.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: 'r2/', ContinuationToken: token }));
    for (const o of page.Contents ?? []) {
      all.push({ name: o.Key, size: o.Size ?? 0, lastModified: o.LastModified });
    }
    token = page.NextContinuationToken;
  } while (token);
  return all;
}

async function main() {
  const env = loadEnvLocal();
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    console.error(
      '.env.local 에 NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 필요합니다.\n' +
        'Supabase 대시보드 → Project Settings → API 에서 "service_role" 비밀 키를 복사해 추가하세요.'
    );
    process.exit(1);
  }

  const missingR2 = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME'].filter((k) => !env[k]);
  if (missingR2.length > 0) {
    console.error(`.env.local 에 다음 값이 없습니다: ${missingR2.join(', ')}`);
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });
  const r2 = new S3Client({
    region: 'auto',
    endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY },
  });

  console.log('저장소의 전체 파일 목록을 가져오는 중...');
  const objects = await listAllObjects(supabase);
  console.log(`Supabase 버킷 파일 총 ${objects.length}개, 총 용량 ${formatBytes(objects.reduce((s, o) => s + o.size, 0))}`);
  const r2Objects = await listR2Objects(r2, env.R2_BUCKET_NAME);
  console.log(`R2 파일 총 ${r2Objects.length}개, 총 용량 ${formatBytes(r2Objects.reduce((s, o) => s + o.size, 0))}\n`);

  console.log('sheets 테이블에서 참조 중인 경로를 가져오는 중...');
  const { data: sheets, error } = await supabase
    .from('sheets')
    .select('file_url, thumbnail_url');
  if (error) {
    console.error('sheets 테이블 조회 실패:', error.message);
    process.exit(1);
  }

  const referenced = new Set();
  for (const sheet of sheets ?? []) {
    if (sheet.file_url) referenced.add(sheet.file_url);
    if (sheet.thumbnail_url) referenced.add(sheet.thumbnail_url);
  }
  console.log(`참조 중인 경로 ${referenced.size}개 (악보 ${sheets?.length ?? 0}개)\n`);

  const supabaseOrphans = objects.filter((o) => !referenced.has(o.name));
  const r2Orphans = r2Objects.filter(
    (o) => !referenced.has(o.name) && Date.now() - o.lastModified.getTime() > R2_MIN_AGE_MS
  );
  const orphans = [...supabaseOrphans, ...r2Orphans];
  const orphanBytes = orphans.reduce((s, o) => s + o.size, 0);

  console.log(`=== 고아 파일(더 이상 참조되지 않음): ${orphans.length}개, ${formatBytes(orphanBytes)} ===`);
  for (const o of orphans.slice(0, 50)) {
    console.log(`  ${o.name}  (${formatBytes(o.size)})`);
  }
  if (orphans.length > 50) {
    console.log(`  ... 외 ${orphans.length - 50}개`);
  }

  if (orphans.length === 0) {
    console.log('\n삭제할 고아 파일이 없습니다.');
    return;
  }

  if (!DELETE) {
    console.log('\n[dry-run] 실제로 삭제하지 않았습니다. 삭제하려면 --delete 옵션을 붙여 다시 실행하세요.');
    return;
  }

  console.log('\n고아 파일을 삭제하는 중...');
  const BATCH = 100;
  let deleted = 0;
  for (let i = 0; i < supabaseOrphans.length; i += BATCH) {
    const batch = supabaseOrphans.slice(i, i + BATCH).map((o) => o.name);
    const { error: removeError } = await supabase.storage.from(BUCKET).remove(batch);
    if (removeError) {
      console.error(`Supabase 삭제 실패 (batch ${i}):`, removeError.message);
      continue;
    }
    deleted += batch.length;
  }
  for (let i = 0; i < r2Orphans.length; i += BATCH) {
    const batch = r2Orphans.slice(i, i + BATCH).map((o) => ({ Key: o.name }));
    try {
      await r2.send(new DeleteObjectsCommand({ Bucket: env.R2_BUCKET_NAME, Delete: { Objects: batch } }));
      deleted += batch.length;
    } catch (err) {
      console.error(`R2 삭제 실패 (batch ${i}):`, err.message);
    }
  }
  console.log(`완료: ${deleted}개 삭제 (전체 고아 파일 ${orphans.length}개, ${formatBytes(orphanBytes)}).`);
}

main();
