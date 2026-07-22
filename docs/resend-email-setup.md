# 이메일 인증(가입 확인)을 Resend로 연결하기

## 결론부터: 도메인 없이 가능한가?

**베타테스터에게 실제로 코드 메일을 보내려면 도메인이 필요합니다.** Vercel이 기본 제공하는
`xxx.vercel.app` 도메인은 DNS를 Vercel이 소유하고 있어서 Resend에 소유권 인증(DKIM/SPF 레코드 추가)을
할 수 없습니다. 이건 Resend만의 제약이 아니라 SendGrid/Mailgun/SES 등 거의 모든 트랜잭션 메일
서비스가 동일합니다(스팸 방지를 위한 표준 절차).

- 도메인이 검증되지 않은 상태에서는 Resend 계정 가입에 사용한 이메일 주소로만 테스트 발송이 가능합니다
  (수신자 = 본인 계정 이메일 한정). 여러 명의 베타테스터에게 코드를 보내는 용도로는 쓸 수 없습니다.
- 저렴한 도메인(연 1~2만원대, `.xyz`/`.app`/`.com` 등)을 하나 구매하면 바로 해결됩니다. Vercel
  Domains에서 사도 되고, 가비아/Cloudflare/Namecheap 등에서 사도 됩니다 — Resend는 등록처를
  가리지 않고 DNS 레코드만 추가하면 됩니다.
- 지금 당장은 도메인 없이도 **본인 이메일로 셀프 테스트**는 가능하니, 아래 절차로 연동까지 먼저
  끝내두고 도메인은 나중에 붙여도 됩니다.

## 아키텍처: 왜 이 방식인가

Resend REST API를 직접 호출하는 커스텀 발송 로직을 새로 만드는 대신, **Supabase Auth의 기존
가입 확인 메일을 Resend SMTP로 중계**하는 방식을 씁니다.

- Supabase가 이미 인증 코드 생성/만료/재사용 방지/속도 제한을 다 처리해줍니다. 직접 구현하면
  `email_verifications` 테이블, service role 키를 쓰는 서버 API, 만료 처리까지 새로 만들어야
  하는데 그럴 필요가 없습니다.
- 이번에 코드에서 바꾼 부분은 [SignUpForm.tsx](../components/auth/SignUpForm.tsx) 하나뿐입니다.
  가입 후 "메일함을 확인하세요" 안내만 띄우던 것을, **6자리 코드를 입력받아
  `supabase.auth.verifyOtp()`로 검증하는 화면**으로 바꿨습니다. 코드 재전송 버튼도 추가했습니다
  (`supabase.auth.resend`).
- 메일을 Resend가 실제로 보내도록 만드는 부분은 코드가 아니라 **Supabase 대시보드 설정**입니다
  (Custom SMTP). 아래 순서대로 진행하면 됩니다.

## 1. Resend에서 도메인 인증

1. [resend.com](https://resend.com) 가입 (가입 이메일 = `siwon2664@gmail.com`이면 이 주소로는
   도메인 없이도 테스트 발송 가능).
2. Resend 대시보드 → **Domains** → **Add Domain** → 소유한 도메인 입력 (예: `bandsetlist.app`).
3. 화면에 나오는 DNS 레코드(TXT, MX, DKIM용 CNAME 등)를 도메인을 구매한 곳(Vercel Domains,
   가비아, Cloudflare 등)의 DNS 설정에 그대로 추가합니다.
4. 몇 분~몇 시간 내 Resend가 자동으로 검증하면 도메인 상태가 "Verified"로 바뀝니다.

## 2. Resend SMTP 자격 증명 확인

Resend 대시보드 → **API Keys** → 새 키 생성(또는 기존 키 사용). SMTP 연결 정보는 다음과 같이
고정되어 있습니다.

- Host: `smtp.resend.com`
- Port: `465` (SSL) 또는 `587` (TLS)
- Username: `resend` (문자 그대로)
- Password: 방금 만든 Resend API 키

## 3. Supabase에 Custom SMTP 연결

Supabase 대시보드 → 프로젝트 선택 → **Project Settings → Authentication → SMTP Settings**

- "Enable Custom SMTP" 켜기
- Host/Port/User/Pass에 위 Resend 값 입력
- Sender email: 검증된 도메인의 주소 (예: `no-reply@bandsetlist.app`) — **검증 안 된 도메인이면
  여기서부터 발송 실패**합니다.
- Sender name: `Band Setlist` 등 원하는 이름

## 4. 이메일 템플릿을 "링크"가 아니라 "코드" 중심으로 변경

Supabase 대시보드 → **Authentication → Email Templates → Confirm signup**

기본 템플릿은 `{{ .ConfirmationURL }}` (클릭形 링크) 위주입니다. 이번에 앱 쪽 로직을
`verifyOtp` 기반 코드 입력 방식으로 바꿨으므로, 템플릿에 6자리 코드 변수인 `{{ .Token }}`을
크게 보여주도록 수정해야 사용자가 입력할 코드를 받을 수 있습니다. 예시:

```html
<h2>Band Setlist 가입 인증</h2>
<p>아래 인증 코드를 앱에 입력해주세요. 코드는 1시간 동안 유효합니다.</p>
<p style="font-size:28px; font-weight:bold; letter-spacing:4px;">{{ .Token }}</p>
```

(링크도 함께 남겨두고 싶다면 `{{ .ConfirmationURL }}` 버튼을 그대로 둬도 무방합니다 — 앱은
`/auth/callback`에서 그 링크도 여전히 처리합니다.)

## 5. 테스트

1. 로컬(`npm run dev`)이나 배포된 앱에서 회원가입.
2. 도메인이 아직 없다면 Resend 가입 이메일로만 테스트해야 합니다. 도메인을 붙였다면 아무
   이메일이나 가능합니다.
3. Resend 대시보드 → **Emails** 로그에서 발송/수신 상태 확인 가능 (스팸함도 확인).
4. 받은 코드를 가입 화면의 "인증 코드" 입력창에 넣고 인증 → 로그인 화면으로 이동하며
   "회원가입이 완료되었습니다" 메시지가 뜨면 정상.

## 참고: 팀 초대 코드와는 별개입니다

`components/team/JoinTeamByCodeForm.tsx`가 쓰는 팀 초대 코드(`invite_token`)는 이메일과
무관하게 팀장이 공유하는 UUID 링크/코드이고, 이번 변경과는 별도의 기능입니다. 이번 문서는
회원가입 시 **이메일 소유 확인**을 위한 인증 코드에 대한 내용입니다.
