// 서버 전용 — Cloudflare R2(S3 호환) 클라이언트와 presigned URL 발급 헬퍼.
// R2 자격증명은 비밀값이라 브라우저 번들에 들어가면 안 되므로, 이 파일은
// Route Handler(app/api/**)에서만 import해야 한다.
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const UPLOAD_URL_TTL_SECONDS = 600; // 업로드 시작까지 걸리는 시간을 넉넉히 줌
const DOWNLOAD_URL_TTL_SECONDS = 60 * 60; // 기존 Supabase signed URL과 동일한 기준

function getBucketName(): string {
  const bucket = process.env.R2_BUCKET_NAME;
  if (!bucket) throw new Error('R2_BUCKET_NAME 환경변수가 설정되지 않았습니다.');
  return bucket;
}

let client: S3Client | null = null;

function getClient(): S3Client {
  if (client) return client;

  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error('R2 환경변수(R2_ACCOUNT_ID/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY)가 설정되지 않았습니다.');
  }

  client = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
  return client;
}

// 형식과 크기를 서명에 포함해야 R2가 발급 때와 다른 업로드를 403으로 거부한다.
// content-type은 signableHeaders로 지정하지 않으면 서명에서 빠져 PUT 때 바꿔치기할 수 있다.
export async function getPresignedUploadUrl(key: string, contentType: string, size: number): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: getBucketName(),
    Key: key,
    ContentType: contentType,
    ContentLength: size,
  });
  return getSignedUrl(getClient(), command, {
    expiresIn: UPLOAD_URL_TTL_SECONDS,
    signableHeaders: new Set(['content-type']),
  });
}

export async function getPresignedDownloadUrl(key: string): Promise<string> {
  const command = new GetObjectCommand({ Bucket: getBucketName(), Key: key });
  return getSignedUrl(getClient(), command, { expiresIn: DOWNLOAD_URL_TTL_SECONDS });
}

// S3 호환 DeleteObjects는 한 번에 최대 1000개까지만 허용한다 — 이 앱 규모에선
// 한 번에 그만큼 지울 일이 없으므로 별도 배치 처리는 하지 않는다.
export async function deleteR2Objects(keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  const command = new DeleteObjectsCommand({
    Bucket: getBucketName(),
    Delete: { Objects: keys.map((Key) => ({ Key })) },
  });
  await getClient().send(command);
}

async function listR2Objects(prefix: string): Promise<{ key: string; size: number }[]> {
  const objects: { key: string; size: number }[] = [];
  let token: string | undefined;
  do {
    const page = await getClient().send(
      new ListObjectsV2Command({ Bucket: getBucketName(), Prefix: prefix, ContinuationToken: token })
    );
    for (const { Key, Size } of page.Contents ?? []) {
      if (Key) objects.push({ key: Key, size: Size ?? 0 });
    }
    token = page.NextContinuationToken;
  } while (token);
  return objects;
}

export async function getR2PrefixSize(prefix: string): Promise<number> {
  const objects = await listR2Objects(prefix);
  return objects.reduce((sum, object) => sum + object.size, 0);
}

export async function deleteR2Prefix(prefix: string): Promise<void> {
  const keys = (await listR2Objects(prefix)).map((object) => object.key);
  for (let i = 0; i < keys.length; i += 1000) {
    await deleteR2Objects(keys.slice(i, i + 1000));
  }
}
