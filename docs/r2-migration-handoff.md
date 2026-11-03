# 악보 파일 저장소 R2 이전: 인수인계 문서

작성일: 2026-11-03

이 문서만 보고 다른 PC에서 이어갈 수 있게 정리했다. 비밀값은 일부러 넣지 않았다.

## 한 줄 요약

Supabase Storage 무료 한도(1GB) 초과로 Storage가 막혀서, 악보 파일을 Cloudflare R2로 옮기는 중이다.
**코드는 작성했지만 커밋, 배포, 브라우저 테스트, 기존 파일 이전은 전부 아직 안 했다.**

## 먼저 확인: 코드가 새 PC에 있는가

이 문서를 쓴 시점에 R2 코드는 **원래 PC의 작업 폴더에만 있고 커밋되지 않았다.**
`git clone`만 하면 변경 사항이 없다. 아래 파일이 있는지 확인한다.

- `lib/r2.ts`
- `lib/sheetStorage.ts`
- `lib/serverTeamAuth.ts`
- `app/api/storage/` (`upload-url`, `signed-urls`, `remove`)
- `scripts/migrateSheetsToR2.mjs`
- `scripts/findOrphanedStorage.mjs`

없으면 원래 PC에서 작업 브랜치로 푸시했는지 확인한다.
`main`에 바로 푸시하면 준비되기 전에 배포될 수 있으니 주의한다.

## 새 PC 준비

1. `npm install`
2. 프로젝트 루트에 `.env.local` 생성 (git에 안 올라간다)

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET_NAME=band-setlist-sheets
```

| 변수 | 가져올 곳 |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase 프로젝트 URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase API Keys의 `sb_publishable_...` |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase API Keys의 `sb_secret_...` |
| `R2_ACCOUNT_ID` | Cloudflare R2 개요의 Account ID (32자리 hex) |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | R2 API 토큰 (Secret은 발급 시 한 번만 표시, 분실 시 재발급) |

- 비밀값은 채팅에 붙여넣지 말고 파일에 직접 입력한다.
- 원래 PC의 `.env.local`에는 `NEXT_PUBLIC_SUPABASE_ANON_KEY`가 없었다.
- 루트의 `.env`에는 예시 문구만 들어 있어서 쓰지 않는다.

## 현재 상태

| 항목 | 상태 |
|---|---|
| Storage 사용량 | DB 기록 기준 1,086.7MB에서 917.2MB로 감소 |
| Storage 제한 | 사용자가 풀렸다고 확인함. 스크립트로는 아직 확인 못 함 |
| Supabase 접속 | **2026-11-03 확인 시 실패.** 프로젝트 주소가 `ENOTFOUND`, supabase.com은 정상. 일시정지 가능성이 있으나 원인 미확인 |
| R2 연결 | presigned 업로드, 다운로드, 삭제 정상 (Node 테스트) |
| R2 CORS | **미완료.** localhost 사전 요청이 403 |
| 타입체크 | `npx tsc --noEmit` 통과 |
| 브라우저 테스트 | **안 함** |
| ESLint | 프로젝트에 설정이 없어 실행 못 함 |
| 커밋, 배포 | **안 함.** 실제 사이트는 예전 코드로 동작 중 |
| 배포 서비스 | 미확인 |

## 남은 작업 (순서 중요)

### 1. Supabase 상태 확인
대시보드에서 프로젝트가 Paused인지 본다. 일시정지 상태면 Restore한다.

### 2. R2 CORS 설정
Cloudflare 대시보드 → R2 → `band-setlist-sheets` → 설정 → CORS 정책

```json
[
  {
    "AllowedOrigins": ["http://localhost:3000", "https://실제-배포-도메인"],
    "AllowedMethods": ["GET", "PUT"],
    "AllowedHeaders": ["Content-Type", "Range"],
    "ExposeHeaders": ["Accept-Ranges", "Content-Length", "Content-Range"],
    "MaxAgeSeconds": 3600
  }
]
```

### 3. 로컬 테스트
`npm run dev` 후 확인한다.

- 새 악보 업로드 후 R2에 `r2/{팀ID}/...` 객체가 생기는지
- 목록 썸네일, 미리보기, 연주모드, PDF 내보내기
- 악보 수정(파일 교체)과 삭제 후 R2에서 이전 객체가 사라지는지

### 4. 커밋하고 배포
배포 서비스 환경변수에 `R2_*` 4개를 추가한다.

### 5. 기존 파일 이전
**반드시 4번 다음에 한다.** 먼저 옮기면 예전 코드가 `r2/` 경로를 읽지 못해 실제 사이트의 악보가 전부 안 보인다.

```bash
node scripts/migrateSheetsToR2.mjs
```

위 명령은 대상 목록만 출력한다. 확인 후 실제로 옮긴다.

```bash
node scripts/migrateSheetsToR2.mjs --run
```

- 행마다 다운로드, R2 업로드, DB 경로 갱신, Supabase 원본 삭제 순서로 진행한다.
- 이미 `r2/`인 경로는 건너뛰므로 다시 실행해도 안전하다.
- 조회가 기본 1,000행까지일 수 있다. 악보가 그보다 많으면 끝난 뒤 다시 실행한다.
- 아래 20개는 파일이 없어 실패로 나오는 것이 정상이다. 이 행들의 썸네일은 Supabase에 남는다.

### 6. 삭제된 악보 20개 복구
앱에서 **수정 → 파일 추가 → 저장**으로 원본을 다시 올린다. 악보 ID가 유지되어 콘티가 그대로 남는다. 필기 위치는 어긋날 수 있다.

### 7. Supabase secret key 교체
이전 작업 중 secret key 전체가 AI 대화 기록에 남았다. 이전이 끝나면 새로 발급해 교체하고, 예전 키는 폐기한다.

## 복구 불가로 삭제한 파일

SQL로 `storage.objects`에서 삭제했다. 고아 파일 19개(13MB)와 아래 PDF 20개(약 157MB)다.
PDF 20개는 백업이 없어서 원본을 따로 구해야 한다.

1. 하나님의 음성을(시편 40편)
2. 부르신 곳에서
3. 실로암
4. 태산을 넘어 험곡에 가도
5. 저 죽어가는 내 형제에게 E Key
6. 겸손
7. 아무것도 두려워 말라
8. 하늘의 해와 달들아
9. 주님 내가 여기 있사오니(나를 받으옵소서
10. 눈을 들어 하늘 보라 (믿는 자여 어이할고)
11. 원하고 바라고 기도합니다 C Key
12. 주가 일하시네 A Key
13. 왜
14. 하늘의 문을 여소서(임재)
15. 가장 소중한 주님
16. 오늘 나는
17. 우리 함께 기뻐해 F Key
18. 오 주여 도우소서 (지나온 그 많은 날들)
19. 아침 안개 눈 앞 가리듯
20. 주님 다시 오실 때까지(후렴) Bb Key

SQL 삭제는 DB 기록만 지웠을 수 있어서, 실제 파일이 Supabase에 남았는지는 확인하지 못했다.

## 구조 변경 요약

- 새 파일 경로는 `r2/{팀ID}/{uuid}.확장자`다. 기존 파일은 `{팀ID}/{uuid}.확장자`이고, 이 접두사로 저장 위치를 구분한다. DB 스키마 변경은 없다.
- 업로드: 브라우저가 경로를 만들고 `/api/storage/upload-url`에서 presigned PUT URL을 받아 R2로 직접 보낸다.
- 읽기: `/api/storage/signed-urls`. `r2/`는 R2, 나머지는 Supabase로 서명한다.
- 삭제: `/api/storage/remove`. 호출하는 쪽은 실패해도 넘어간다.
- 권한: R2에는 RLS가 없어서 라우트에서 `team_members`로 직접 확인한다 (`lib/serverTeamAuth.ts`).
- 클라이언트는 `lib/sheetStorage.ts`만 호출한다. `lib/r2.ts`는 서버 전용이다.
- 이번에 삭제, 수정 시 Storage 파일이 안 지워지던 버그도 함께 고쳤다.

## 아직 해결 안 된 점

- **업로드 파일 형식, 크기 제한이 서버에 없다.** Supabase 버킷의 형식 제한(`20260723010000_restrict_sheet_file_types.sql`)이 R2에는 적용되지 않는다. 현재는 브라우저 검사뿐이고, `upload-url` 라우트에서 검증하는 것이 좋다.
- **팀 삭제, 계정 삭제 시 R2 파일이 남는다.** DB cascade로 행만 지워진다.
- `scripts/findOrphanedStorage.mjs`는 Supabase 버킷만 검사한다. R2 고아 파일은 찾지 못한다.
- `scripts/backfillPdfThumbnails.mjs`도 아직 Supabase Storage 기준이다.
- PDF는 여전히 압축 없이 원본 그대로 올라간다. R2 무료 한도는 10GB다.
