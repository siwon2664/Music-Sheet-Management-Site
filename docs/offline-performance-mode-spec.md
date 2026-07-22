# 연주모드 오프라인 대비 — 구현 요구사항

> 이 문서는 나중에 실제 구현을 요청할 때 그대로 프롬프트로 쓸 수 있도록 작성한
> 요구사항 명세입니다. 배경 설명 → 요구사항 → 파일별 작업 → 완료 기준 순으로
> 구성했습니다.

## 배경 / 문제

`PerformanceMode.tsx`는 연주 시작 시 콘티에 담긴 곡들의 Supabase Storage
signed URL을 한 번에 발급받고(`createSignedUrls`), 각 URL을 `fetch()`로 한 번
호출해 브라우저 HTTP 캐시를 "데워두는" 정도로만 대비하고 있다. 이 방식은:

- 브라우저(특히 모바일 Safari)가 저장공간이 부족하면 HTTP 캐시를 임의로 비울 수
  있어 지속성이 보장되지 않는다.
- signed URL 자체가 시간이 지나면 만료되는 임시 주소라, 세션이 오래가면 새
  signed URL을 다시 받아와야 하고 그 시점에 네트워크가 필요하다.
- 공연/예배 중 와이파이가 완전히 끊기면 이미 열어본 곡이라도 다시 안 뜰 수 있다.

**목표**: 연습(온라인 상태)에서 콘티를 한 번 열어보면, 이후 공연 중 네트워크가
완전히 끊겨도 그 콘티의 모든 곡(악보 파일 + 본인이 그린 마킹)이 계속 보이도록
한다.

## 범위

**포함**: 연주모드(`PerformanceMode.tsx`)에서 악보 파일(PDF/이미지)과 본인의
필기(`drawings`)를 오프라인에서도 볼 수 있게 하는 것.

**제외** (이번 작업 대상 아님):
- 대시보드, 악보 라이브러리, 편집 화면 등 다른 화면의 오프라인 지원
- 오프라인 상태에서 새 필기를 저장하고 나중에 동기화하는 것(추후 별도 논의)
- 오프라인 상태에서 악보 업로드/편집

## 핵심 설계 원칙

1. **signed URL이 아니라 `sheetId`를 캐시 키로 쓴다.** signed URL은 만료되는
   임시 주소라 그대로 캐시 키로 쓰면 다음 세션에 무용지물이다. 파일의 실제
   바이트(Blob)를 `sheetId` 기준으로 저장하고, signed URL은 "그 바이트를 받아올
   최초 1회용 통로"로만 취급한다.
2. **캐시 신선도는 `sheets.updated_at`으로 판단한다.** 악보 파일이
   교체(재업로드)되면 `sheets.updated_at`이 바뀌므로, 캐시에 저장된 버전의
   `updated_at`과 현재 DB 값이 다르면 캐시를 무효화하고 새로 받는다.
3. **네트워크 우선, 실패 시 캐시 폴백.** 온라인이면 항상 최신 파일을 받아오려
   시도하고, 그 요청이 실패(오프라인, 타임아웃)했을 때만 캐시된 버전을 쓴다.
   단, 명시적으로 "오프라인 모드"임이 감지되면(navigator.onLine === false)
   네트워크 시도 자체를 건너뛰고 바로 캐시를 사용해 지연을 없앤다.
4. **저장 공간은 유한하다고 가정한다.** `QuotaExceededError`를 항상 처리하고,
   저장 실패가 곡 표시 자체를 막지 않도록 한다(캐시 저장은 "베스트 에포트").

## 요구사항 상세

### 1. 로컬 저장소: Cache Storage API 사용

IndexedDB로 Blob을 직접 다루는 것보다 `caches` (Cache Storage API)가 Response
객체를 그대로 저장/조회할 수 있어 더 간단하다. 다음과 같은 구조로 쓴다:

- 캐시 이름: `sheet-files-v1` (버전 접미사로 스키마 변경 시 마이그레이션 가능하게)
- 캐시 키(가짜 URL): `https://cache.local/sheets/{sheetId}?updatedAt={encodeURIComponent(updatedAt)}`
  — 실제 네트워크 요청은 안 나가는 합성 URL이며, `updatedAt`을 쿼리에 포함시켜
  버전이 다르면 자동으로 다른 캐시 엔트리가 되게 한다(이전 버전은 별도 정리 필요).
- 필기(`drawings.coordinates`)는 파일보다 훨씬 작은 JSON이라 Cache Storage에
  JSON을 담은 `Response`로 저장하거나, `localStorage`에 `sheetId+userId` 키로
  직접 저장해도 충분하다. Cache Storage 쪽으로 통일하는 걸 권장(관리 포인트를
  하나로).

### 2. 공용 유틸리티: `lib/offlineSheetCache.ts` (신규)

다음 함수를 제공한다:

```ts
cacheSheetFile(sheetId: string, updatedAt: string, blob: Blob): Promise<void>
getCachedSheetFile(sheetId: string, updatedAt: string): Promise<Blob | null>
cacheDrawing(sheetId: string, userId: string, updatedAt: string, strokes: unknown): Promise<void>
getCachedDrawing(sheetId: string, userId: string): Promise<unknown | null>
isSheetCached(sheetId: string, updatedAt: string): Promise<boolean>
clearOfflineCache(): Promise<void>
estimateCacheUsage(): Promise<{ usageBytes: number; quotaBytes: number } | null> // navigator.storage.estimate() 래핑
```

- 모든 함수는 `'caches' in window` 가드로 감싸서, Cache Storage API를 지원하지
  않는 환경(사파리 구버전 등)에서도 앱이 죽지 않고 조용히 오프라인 캐싱만
  비활성화되게 한다.
- 저장 실패(`QuotaExceededError` 등)는 콘솔 경고만 남기고 상위로 예외를 던지지
  않는다 — 캐싱 실패가 화면 표시를 막으면 안 된다.

### 3. `PerformanceMode.tsx` 수정

- 연주모드 진입 시 signed URL을 받아온 뒤, 기존 `fetch(url)` 워밍업 자리에서
  응답을 `.blob()`으로 받아 `cacheSheetFile(item.sheetId, item.updatedAt, blob)`
  호출로 교체(단순 워밍업 → 실제 영구 저장).
- 같은 시점에 현재 로그인 유저의 `drawings` 값도 함께 가져와
  `cacheDrawing(...)`으로 저장한다 (지금 `DrawingLayer`가 각자 알아서
  불러오는 구조이므로, `DrawingLayer`가 오프라인일 때 이 캐시를 읽도록 4번
  항목과 연동).
- 헤더 또는 곡 리스트 어딘가에 **"오프라인 저장됨" 표시**(예: 작은 체크
  아이콘)를 곡별로 노출해서, 사용자가 "이 콘티는 지금 다 저장됐다"를 눈으로
  확인할 수 있게 한다. `isSheetCached()`로 각 곡 상태를 조회.
- `navigator.onLine === false`이거나 signed URL 발급 자체가 실패했을 때, 이미
  캐시된 곡이 있다면 에러 화면 대신 캐시된 파일로 계속 진행할 수 있게
  폴백한다 (곡별로 개별 처리 — 콘티 전체가 아니라 곡 단위로 성공/실패가 갈릴
  수 있음을 감안).

### 4. `PdfPageViewer.tsx` / `ImageDrawingStage.tsx` 수정

두 컴포넌트 다 지금은 `src`(signed URL)를 그대로 받아서 로드한다. 다음처럼
바꾼다:

- props로 `sheetId`, `updatedAt`을 추가로 받는다 (이미 `sheetId`는 받고 있으니
  `updatedAt`만 추가하면 됨 — 상위에서 `SetlistItem`/`SheetRow`에 이 필드가
  없다면 함께 추가).
- 로드 로직: `src`로 네트워크 요청을 시도하되, 실패하거나
  `navigator.onLine === false`면 `getCachedSheetFile(sheetId, updatedAt)`로
  받은 Blob을 `URL.createObjectURL()`로 변환해서 대신 사용한다.
- `PdfPageViewer`는 pdf.js의 `getDocument()`에 URL 대신 Blob에서 만든
  `ArrayBuffer`를 직접 넘길 수 있으므로(`getDocument({ data: arrayBuffer })`),
  캐시 폴백 시 이 방식을 쓴다.
- `DrawingLayer`도 마찬가지로, `drawings` 테이블 조회가 실패하면(오프라인)
  `getCachedDrawing(sheetId, userId)`로 폴백해서 본인 마킹이 오프라인에서도
  보이게 한다. 단, 오프라인 상태에서는 새로 그린 필기의 `persist()` 저장은
  실패할 수밖에 없으므로 — 저장 실패 시 조용히 무시하지 말고 "오프라인
  상태라 저장이 안 됐다"는 걸 사용자에게 알리는 최소한의 표시(예: 상단에
  작은 배지)를 추가한다. 오프라인 상태에서 그린 필기를 로컬에 큐잉했다가
  재연결 시 동기화하는 것은 이번 범위에서 제외(향후 과제로 명시).

### 5. PWA 설치 지원 (선택 — 오프라인 캐싱과 별개로 값어치 있음)

- `app/manifest.ts` (Next.js 14 App Router의 Metadata API로 매니페스트 생성)
  추가: `name`, `short_name`, `icons`(192/512px), `start_url: '/dashboard'`,
  `display: 'standalone'`, `theme_color`, `background_color`.
- `app/layout.tsx`에 `<meta name="apple-mobile-web-app-capable" content="yes">`
  등 iOS 홈 화면 추가 관련 메타 태그 보강.
- 이 항목은 "홈 화면에 추가"로 앱처럼 켤 수 있게 하는 것으로, 위 오프라인
  캐싱 요구사항과는 독립적으로 동작한다(오프라인 캐싱이 PWA 설치 여부와
  무관하게 먼저 동작해야 함).

### 6. 서비스 워커 사용 여부

이번 스펙은 **서비스 워커 없이 Cache Storage API를 애플리케이션 코드에서
직접 호출**하는 방식으로 충분하다(캐싱 시점이 "연주모드 진입 시"로 명확히
정해져 있어서, 네트워크 요청을 가로채는 서비스 워커의 프록시 능력이 굳이
필요 없음). 다만 5번(PWA 설치)까지 하려면 최소한의 서비스 워커 등록은
필요할 수 있으니, 그 경우 직접 작성하기보다 `serwist`(구 next-pwa 계승
프로젝트) 같은 Next.js App Router 호환 라이브러리 사용을 우선 검토할 것.

## 파일별 작업 목록

| 파일 | 작업 |
|---|---|
| `lib/offlineSheetCache.ts` | 신규 — 3번 항목의 캐시 유틸리티 |
| `components/dashboard/setlist-editor/PerformanceMode.tsx` | 워밍업 fetch를 캐시 저장으로 교체, 곡별 "오프라인 저장됨" 표시, 오프라인 폴백 |
| `components/sheets/PdfPageViewer.tsx` | `sheetId`/`updatedAt` prop 추가, 네트워크 실패 시 캐시 Blob 폴백 |
| `components/sheets/ImageDrawingStage.tsx` | 위와 동일 |
| `components/sheets/DrawingLayer.tsx` | `drawings` 조회 실패 시 캐시 폴백, 오프라인 저장 실패 안내 배지 |
| `components/dashboard/setlist-editor/SetlistPanel.tsx` (또는 `SetlistItem` 타입 정의부) | `updatedAt` 필드 추가 필요 여부 확인 |
| `app/manifest.ts` | 신규 (PWA, 선택 항목) |
| `app/layout.tsx` | iOS 메타 태그 보강 (PWA, 선택 항목) |

## 완료 기준 (테스트 시나리오)

1. 온라인 상태에서 콘티를 열어 모든 곡을 한 번씩 넘겨본다(캐시 채우기).
2. 브라우저 개발자도구 Network 탭에서 **오프라인으로 전환**(또는 기기
   비행기 모드)한다.
3. 연주모드를 다시 시작(또는 새로고침)해도 방금 본 곡들의 악보와 본인
   필기가 그대로 보여야 한다.
4. 팀장이 그 사이 악보 파일을 재업로드(`updated_at` 갱신)한 경우, 온라인
   상태에서 다시 열면 캐시가 아니라 새 파일이 보여야 한다(캐시 무효화 확인).
5. 시크릿 모드 등 Cache Storage API 저장 용량이 매우 작은 환경에서
   `QuotaExceededError`가 나도 앱이 죽지 않고 온라인일 때는 정상 동작해야
   한다.
6. 한 번도 열어본 적 없는 곡을 오프라인 상태에서 열면(캐시 없음) — 크래시
   없이 "오프라인 상태라 이 곡은 불러올 수 없습니다" 같은 안내가 떠야 한다.
