# Blacksmith형 Palate 상태 페이지 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Blacksmith 상태 페이지의 정보 밀도를 참고하되 Palate 시각 언어를 유지하는 모바일 우선 공개 상태 페이지를 만든다.

**Architecture:** 기존 Astro 정적 문서, 브라우저 hydration, Cloudflare Worker/D1 공개 projection을 유지한다. UI 계층에서 최대 30개 일별 표본을 고정 30일 rail로 투영하고, GitHub content의 종료 장애와 완료 점검을 KST 날짜별 이력으로 묶는다. Worker, D1 스키마, 모니터, 보안, 배포 설정은 변경하지 않는다.

**Tech Stack:** Astro, TypeScript, Vitest, vanilla DOM hydration, Cloudflare Worker/D1

## Global Constraints

- 공개 저장소다. 토큰, 계정 식별자, 개인정보, `.env`, `.dev.vars`, raw provider payload를 파일·로그·테스트 fixture에 넣지 않는다.
- `worker/`, `migrations/`, `wrangler.jsonc`, `.github/workflows/`와 공개 API 계약은 이 계획에서 수정하지 않는다.
- Web과 API 두 서비스만 표시한다. 그룹 접기, 구독, 신고, 유료 SaaS 기능은 추가하지 않는다.
- rail은 desktop/mobile 모두 오늘을 포함한 UTC 30일이다. 누락일은 장애가 아니라 관측 없음으로 표시한다.
- Palate coral과 green을 쓴다. Blacksmith의 검정/파랑 스타일을 복제하지 않는다.
- H1→H2→H3→H4 순서를 지키고 작은 텍스트도 WCAG AA 대비를 만족한다.
- 각 구현 task는 RED→GREEN focused test, 작은 logical commit, task review를 통과해야 한다. 리뷰 실패 2회면 추가 반복 대신 설계를 다시 검토한다.
- 개발 gate는 focused test다. 전체 UI/브라우저 QA는 통합 단계에서 한 번 실행한다.

---

## Task 1: 서비스별 30일 가동률 rail 통합

**Files:**

- Modify: `src/status/view-model.ts`
- Modify: `src/status/view-model.test.ts`
- Modify: `src/components/OverallStatus.astro`
- Modify: `src/components/ComponentStatus.astro`
- Modify: `src/components/UptimeBars.astro`
- Modify: `src/pages/index.astro`
- Modify: `src/scripts/status-client.ts`
- Modify: `src/scripts/status-client.test.ts`
- Modify: `src/styles/global.css`
- Create: `src/status/status-page-build.test.ts`

### Behavior

- [ ] `view-model.ts`에 `buildThirtyDayUptimeRail(days, now)` 순수 함수를 export한다.
- [ ] 유효한 `now` 기준 오늘 포함 UTC 30일을 생성하고 실제 `DailyUptimePoint`를 날짜로 join한다.
- [ ] 누락일은 `upSamples: 0`, `downSamples: 0`, `expectedSamples: 0`, `uptimePercent: null`, `coveragePercent: 0`으로 만든다.
- [ ] 잘못된 `now`는 throw하지 않고 받은 표본만 기존 label 형식으로 투영한다.
- [ ] `toStatusViewModel()`이 모든 서비스의 `days`에 30일 projection을 사용한다.
- [ ] 큰 상태별 전체 배너를 만들고 Web/API 각각을 현재 상태, 30일 가동률, 측정 범위, 마지막 관측, 30개 rail이 한 행에 있는 service row로 만든다.
- [ ] 초기 정적 HTML도 서비스당 30개 `data-uptime-placeholder` segment를 렌더한다. placeholder는 `aria-hidden`, 목록에는 screen-reader용 `측정 데이터 없음`을 둔다.
- [ ] hydration은 같은 compact segment 구조를 만든다. 실제 segment는 `data-uptime-day`, `aria-label`, `title`을 가지며 날짜/count 텍스트를 내부에 반복하지 않는다.
- [ ] 별도 `최근 30일 업타임` section을 제거하고 H2 `서비스 상태와 최근 30일 가동률` 아래 service H3, uptime H4 구조로 합친다.
- [ ] rail CSS는 `repeat(30, minmax(0, 1fr))`, `gap: 2px`, desktop 높이 42px, mobile 높이 34px로 만들고 수평 overflow를 허용하지 않는다.

### TDD

- [ ] `view-model.test.ts`에 `2026-08-09T12:20:00Z`와 8월 8·9일 표본만 주고 30개, 첫날 `2026-07-11`, 마지막날 `2026-08-09`를 기대하는 실패 테스트를 먼저 추가한다.
- [ ] 첫 누락일이 null uptime, expected 0, coverage 0이며 aria label에 `가동률 측정 데이터 없음`이 포함되는지 검증한다.
- [ ] `status-page-build.test.ts`에 build 결과가 통합 heading, 서비스 두 개, placeholder 60개를 포함하고 `Read uptime graph for undefined`를 포함하지 않는지 검증한다.
- [ ] DOM hydration test가 서비스별 30개 segment와 unavailable fallback을 검증하게 한다.

### Verification

- [ ] `bun run test -- src/status/view-model.test.ts src/status/status-page-build.test.ts src/scripts/status-client.test.ts`
- [ ] `bun run check`
- [ ] `bun run build`
- [ ] `git diff --check`

### Commit

- [ ] 다음 형식으로 commit한다.

```text
STYLE: 서비스별 30일 가동률 rail 통합

- 어떤 작업을 했는가: 전체 상태 배너와 Web/API별 30일 가동률 rail 통합
- 어떤 이슈인가: 구성 요소 상태와 uptime이 분리되어 운영 상태 스캔이 느림
- 그래서 무엇을 했는가: 기존 public projection을 30일 고정 rail로 변환하고 반응형 service row 구현
```

---

## Task 2: 장애·점검 이력을 날짜별로 통합

**Files:**

- Modify: `src/status/view-model.ts`
- Modify: `src/status/view-model.test.ts`
- Create: `src/components/IncidentEntry.astro`
- Create: `src/components/MaintenanceEntry.astro`
- Create: `src/components/HistoryTimeline.astro`
- Modify: `src/components/IncidentList.astro`
- Modify: `src/components/MaintenanceList.astro`
- Modify: `src/pages/index.astro`
- Modify: `src/styles/global.css`
- Modify: `src/status/status-page-build.test.ts`

### Behavior

- [ ] `view-model.ts`에 종료 장애와 완료·취소 점검을 하나의 discriminated union으로 만드는 `groupResolvedHistory(incidents, maintenance)`를 export한다.
- [ ] 장애 시각은 `resolvedAt ?? startedAt`, 점검 시각은 `endsAt ?? startsAt`을 사용한다.
- [ ] Asia/Seoul 날짜 key로 묶고 그룹은 최신순, 그룹 안 항목도 완료 시각 최신순으로 정렬한다.
- [ ] `IncidentEntry.astro`, `MaintenanceEntry.astro`가 기존 본문·시간·상태 markup을 소유하고 `headingLevel: "h3" | "h4"`를 받는다.
- [ ] 진행 장애와 예정 점검 section은 H2 아래 H3 entry를 사용한다.
- [ ] `HistoryTimeline.astro`는 H2 `지난 운영 기록`, H3 날짜, H4 entry 구조를 사용한다.
- [ ] 기존 history용 중첩 `IncidentList`/`MaintenanceList` 호출을 제거한다.
- [ ] 작은 회색 text는 `#6b6b6b` 이상 대비, 작은 coral text는 `#c12f47`을 사용한다. brand/focus coral은 기존 token을 유지한다.

### TDD

- [ ] 장애 resolved `2026-08-09T00:30:00Z`, 점검 ended `2026-08-09T01:00:00Z` fixture를 먼저 추가한다.
- [ ] 한 KST `2026-08-09` 그룹과 `[maintenance, incident]` 순서를 기대해 RED를 확인한다.
- [ ] build test는 충돌 가능성이 없는 reserved year 9997 content fixture를 exclusive create하고 이 테스트가 만든 파일만 cleanup한다.
- [ ] build HTML에서 날짜 heading 하나, 두 title, 점검 title이 장애 title보다 앞에 있음을 검증한다.
- [ ] 정적 heading level이 H1→H2→H3→H4에서 건너뛰지 않는지 검증한다.

### Verification

- [ ] `bun run test -- src/status/view-model.test.ts src/status/status-page-build.test.ts`
- [ ] `bun run check`
- [ ] `bun run build`
- [ ] `git diff --check`

### Commit

- [ ] 다음 형식으로 commit한다.

```text
STYLE: 장애와 점검 이력을 날짜별로 통합

- 어떤 작업을 했는가: 종료 장애와 완료 점검을 날짜별 공개 운영 이력으로 통합
- 어떤 이슈인가: 분리된 이력과 잘못된 heading 단계가 시간순 파악과 접근성을 저해
- 그래서 무엇을 했는가: KST 완료일 projection, 재사용 entry markup, H1부터 H4까지 연속 구조 구현
```

---

## Task 3: 통합 검증과 PR 갱신

**Files:**

- Verify only unless a focused fix is required.
- Update: existing GitHub PR body after all local gates pass.

### Local integration gate

- [ ] `bun run test -- src/status/view-model.test.ts src/status/status-page-build.test.ts src/scripts/status-client.test.ts`
- [ ] `bun run check`
- [ ] `bun run build`
- [ ] `bunx wrangler types --check`
- [ ] `git diff --check`
- [ ] `git status --short`

### Orca browser QA

- [ ] Orca CLI terminal에서 `bun run dev -- --port 8787`을 시작한다.
- [ ] 320×844, 390×844, 1280×900 viewport에서 `scrollWidth === innerWidth`를 확인한다.
- [ ] mobile은 한 열, desktop content는 최대 960px, 각 서비스 rail은 정확히 30개인지 측정한다.
- [ ] heading sequence에 level skip이 없고 hydration 뒤 `aria-busy="false"`인지 확인한다.
- [ ] empty local D1의 `/api/status` 503이 화면에서 `상태 확인 불가`로 표현되는지 확인한다.
- [ ] console error 0개와 desktop/mobile screenshot을 증거로 남긴다.
- [ ] 실제 mixed state는 저장소 밖 임시 D1 persistence 또는 안전한 browser interception으로 검증한다. 비밀 fixture 파일은 만들지 않는다.

### Review and publish

- [ ] 전체 branch diff를 Sol reviewer가 검토한다.
- [ ] Critical/Important finding을 한 번의 fix wave로 처리하고 scoped re-review한다.
- [ ] commit 전 `git status --short`, `git diff --cached --name-only`, `git diff --cached --check`를 확인한다.
- [ ] 기존 PR 본문을 한국어로 갱신하고 검증 명령과 UI QA 증거를 기록한다.
- [ ] branch를 push한 뒤 remote SHA를 확인한다.
- [ ] 새 head의 CI 상태는 즉시 한 번만 확인한다. pending/queued는 성공으로 보고하지 않는다.
- [ ] 사용자 지시 없이 merge하지 않는다.
