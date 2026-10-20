# 경민물류 배차 앱

종이·엑셀 "경민물류 일정표"를 휴대폰 중심 앱(PWA)으로 옮긴 배차 프로그램입니다. 휴대폰과 PC가 같은 데이터를 보고, 엑셀로 내보내고 올릴 수 있습니다.

- 프론트: React + TypeScript + Vite, PWA (홈 화면 설치, 오프라인 보기·입력)
- 클라우드: Supabase (PostgreSQL, 로그인, 실시간 동기화, RLS 권한, 사진 저장소, 매일 새벽 스케줄러)
- 엑셀: ExcelJS · 날짜: dayjs (Asia/Seoul 고정)

## 1. 바로 실행 (데모 모드)

```bash
npm install
npm run dev        # http://localhost:5173
```

`.env`가 없으면 **데모 모드**로 열립니다. 이 기기 브라우저에만 저장되며 관리자/배차/기사 역할을 골라 볼 수 있습니다. 데모 데이터에는 요구사항의 예시(전날 육지 상차 9915 → 오늘 제주 하차, 9914 선박 이어짐, 8948 야간 감귤 등)가 오늘 날짜 기준으로 들어 있습니다.

```bash
npm test           # 도메인 규칙 단위 테스트 (반복 발주 · 상차→하차 연결 · 선박 이어짐 · 정비 · 엑셀)
npm run build      # 배포용 빌드 (dist/)
```

## 2. Supabase 연결

1. supabase.com에서 프로젝트를 만듭니다.
2. SQL Editor에서 순서대로 실행합니다.
   - `supabase/migrations/20261020000001_schema.sql` (테이블)
   - `supabase/migrations/20261020000002_rls_audit_realtime.sql` (권한 · 변경 이력 · 실시간 · 기사 알림 · 사진 버킷)
   - `supabase/seed.sql` (선박·차량·기사·거래처·현장근무 기본 데이터)
   - Supabase CLI를 쓴다면 `supabase db push` 후 `psql -f supabase/seed.sql`
3. `.env.example`을 `.env`로 복사한 뒤 Project Settings → API의 URL과 anon key를 넣습니다.
4. 앱에서 **처음 가입한 사람이 관리자**가 됩니다. 이후 가입자는 "조회(기사)"이며, 관리자가 설정 → 사용자 권한에서 배차·관리자로 바꾸거나 기사와 연결합니다.

### 매일 새벽 스케줄러 (반복 발주 8주 연장)

```bash
supabase functions deploy daily-maintenance
```

Vault에 `project_url`과 `service_role_key`를 넣은 뒤 `supabase/migrations/20261020000003_scheduler.sql`을 실행합니다. 매일 03:00(KST)에 반복 발주와 고정 근무를 오늘+8주까지 연장하고 정비 알림·월말 금액 미입력 알림을 만듭니다. 13:00에는 배차 대기 상차 알림을 만듭니다. 앱도 관리자·배차가 열 때 같은 연장을 한 번 더 하므로, 스케줄러가 멈춰도 일정은 비지 않습니다. (같은 날짜가 중복으로 생기지 않도록 DB 고유 인덱스가 막습니다.)

Edge Function은 앱과 **같은 도메인 코드**를 씁니다. `src/domain`을 고친 뒤에는 `npm run sync:functions`를 실행하세요. 복사본이 다르면 테스트가 실패합니다.

## 3. 배포 (Vercel)

1. GitHub 저장소를 Vercel에 Import합니다 (Framework: Vite, Build: `npm run build`, Output: `dist`).
2. Environment Variables에 `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`를 넣습니다 (선택: `VITE_KAKAO_REST_KEY`).
3. 배포 주소를 휴대폰으로 엽니다.
   - Android Chrome: 메뉴 → "홈 화면에 추가" / "앱 설치"
   - iPhone Safari: 공유 → "홈 화면에 추가"

`vercel.json`은 새로고침해도 화면 주소가 유지되도록 설정합니다. Netlify나 Cloudflare Pages도 같은 방식(SPA 리라이트)으로 배포할 수 있습니다.

## 핵심 규칙과 위치

| 규칙 | 코드 | 테스트 |
|---|---|---|
| 반복 발주 버전·과거 불변·수동 수정 보존·종료·미리보기 | `src/domain/recurring.ts` | `recurring.test.ts` |
| 상차 → 다음 날 반대 지역 하차, 수정 전파, 반영/무시, 삭제, 날짜 변경 | `src/domain/orders.ts` | `linking.test.ts` |
| 선박 자동 이어짐 (공차도, 아침/예약/야간, 변경·삭제) | `src/domain/orders.ts` | `linking.test.ts` |
| 차량 위치 자동 결정·공차/수리·배차 대기 | `src/domain/board.ts` | `misc.test.ts` |
| 정비 연동·주행거리 검증·엔진오일 주기 | `src/domain/maintenance.ts` | `misc.test.ts` |
| 현장근무 고정 근무(버전 방식)·휴무 | `src/domain/fieldwork.ts` | `misc.test.ts` |
| 매출 계산 (단가×수량+추가요금, 부가세 10%) | `src/domain/revenue.ts` | `misc.test.ts` |
| 권한: 기사·조회 계정은 읽기만, 금액 행은 서버가 아예 안 내려줌 | `supabase/migrations/…02_rls…sql` | `supabase/tests/rls_test.sql` |

### 설계 메모

- **금액 분리**: `daily_orders`에 금액 컬럼을 두지 않고 `order_revenue`·`product_pricing` 테이블로 분리했습니다. 한 테이블 안에서 컬럼 단위로 사용자별 권한을 다르게 주는 것은 Supabase RLS로 안 되기 때문입니다. 기사·조회 계정은 이 두 테이블의 행을 아예 받지 못합니다.
- **차량 하루 한 줄(`vehicle_days`)**: 선박·상태·기사는 차량 단위 정보입니다. 그래서 짐이 없어도 "선박만" 넣으면 다음 날 반대 지역 줄이 생깁니다.
- **오프라인**: 변경은 화면에 바로 반영되고 IndexedDB에 저장됩니다. 연결되면 전송하고, 다른 사람 변경은 Realtime으로 받습니다. 충돌하면 마지막 저장이 이기고, 편집 중인 항목이 바뀌면 알림을 띄웁니다.
- **변경 이력**: 모든 테이블에 트리거로 `audit_log`(누가·언제·전/후)가 남고, 품목·거래처 화면 하단에 표시됩니다.
- 제주 오전 = 하차(`unload`), 제주 오후 = 상차(`load`)로 저장합니다.

## 아직 남은 것 / 한계

- **첨부 일정표 원본은 받지 못했습니다.** 시드에는 요구사항 본문에 나온 선박·차량번호·직원·근무지만 들어 있고, 트럭 기사 이름은 `기사(9915)` 같은 자리표시자입니다. 엑셀 업로드 양식(설정 → 업로드 양식)으로 실제 명단을 올리면 됩니다.
- **푸시 알림**은 앱이 열려 있거나 백그라운드일 때 Realtime + 브라우저 알림으로 동작합니다. 앱이 완전히 닫힌 상태의 Web Push는 VAPID 키와 발송 서버 설정이 더 필요합니다.
- **주소 → 좌표 변환**과 "현재 위치 → 도로명 주소"는 `VITE_KAKAO_REST_KEY`가 있을 때만 됩니다. 없으면 주소 검색(다음 우편번호)과 좌표만 저장하고, 길찾기는 주소 검색으로 엽니다.
- **휴대폰에서 끌어다 놓기**는 노란 차량 칸 탭(또는 길게 누르기) → 차량 선택으로 대신합니다. 마우스로 끌어다 놓기는 PC 표에서 됩니다.
