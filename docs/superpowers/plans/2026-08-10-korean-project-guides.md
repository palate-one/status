# 한국어 프로젝트 안내 문서 개편 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `README.md`와 `CONTRIBUTING.md`의 기술적 의미는 유지하면서 처음 읽어도 이해하기 쉬운 자연스러운 한국어 안내 문서로 다듬는다.

**Architecture:** 코드와 운영 동작은 건드리지 않는다. README는 서비스 목적과 구조를 설명하고, CONTRIBUTING은 실제 변경 절차와 안전 규칙을 안내하는 현재 역할을 유지한다. 각 문서를 별도 커밋으로 수정한 뒤 두 문서의 경로, 명령, 보안 경계가 일치하는지 함께 검증한다.

**Tech Stack:** Markdown, Bun 1.3.12 저장소 convention 검사, Git diff 검사

## Global Constraints

- 실제 안내 문구를 수정하는 파일은 `README.md`와 `CONTRIBUTING.md`로 제한한다. 승인된 spec과 이 실행 계획은 별도 계획 문서로 유지한다.
- 운영 규칙, API 경로, 파일 경로, 명령, 계산식, 상태 판정 조건은 바꾸지 않는다.
- 기술 문서에 자연스러운 평서형을 사용하고, 코드 식별자와 제품명은 백틱 또는 고유 명칭으로 유지한다.
- `component`, `sample`, `aggregate`, `custom domain`, `credential`, `local`, `production`의 불필요한 영어 혼용을 각각 구성요소, 관측값, 집계, 사용자 지정 도메인, 인증정보, 로컬, 운영 환경으로 정리한다.
- Worker, D1, HMAC, UTC, RFC 3339, API 이름과 코드 필드는 번역하지 않는다.
- token, secret, 이메일, 계정 식별자 또는 실제 인증값을 문서에 추가하지 않는다.

---

### Task 1: README를 현재 운영 상태에 맞는 자연스러운 한국어로 정리

**Files:**
- Modify: `README.md`
- Test: one-shot Bun 문서 회귀 검사

**Interfaces:**
- Consumes: `wrangler.jsonc`의 `status.palate.one` 사용자 지정 도메인, `/api/checks`, `/api/status`, D1 binding 설정
- Produces: 방문자와 개발자가 서비스 목적, 구조, 상태 판정, 공지 작성 위치, 로컬 실행, 무료 운영 경계를 확인할 수 있는 README

- [ ] **Step 1: 현재 문구를 잡는 회귀 검사를 작성하고 실패 확인**

다음 one-shot 검사는 개편 후 반드시 사라져야 할 혼용 표현과 새로 들어갈 실제 상태 페이지 링크를 확인한다.

```sh
bun -e '
import { readFile } from "node:fs/promises";
const text = await readFile("README.md", "utf8");
const failures = [
  [text.includes("[status.palate.one](https://status.palate.one/)"), "상태 페이지 링크"],
  [!text.includes("원시 sample"), "원시 sample"],
  [!text.includes("component 현재 상태"), "component 현재 상태"],
  [!text.includes("custom domain"), "custom domain"],
  [!text.includes("credential이나 secret"), "credential이나 secret"],
];
const failed = failures.filter(([ok]) => !ok).map(([, label]) => label);
if (failed.length) throw new Error(`자연스러운 한국어 개편 필요: ${failed.join(", ")}`);
'
```

Expected: FAIL. 상태 페이지 링크가 없고 기존 영어 혼용 표현이 남아 있어야 한다.

- [ ] **Step 2: 첫 문단과 구조 설명을 독자 중심으로 수정**

`README.md` 첫 문단에 실제 상태 페이지 링크를 넣고, 저장소 역할을 다음 순서로 설명한다.

1. `[status.palate.one](https://status.palate.one/)`에서 Web과 API 상태를 확인할 수 있다.
2. 장애 공지와 점검 일정은 이 공개 저장소의 Markdown으로 관리한다.
3. 구조도 안의 코드 이름은 유지하되, 구조도 아래 설명에서는 `관측`, `구성요소`, `집계`, `공개 상태 스냅샷`을 사용한다.

다음 기술 사실은 그대로 남긴다.

- GitHub Actions가 5분마다 `palate.one`과 `api.palate.one/readyz`를 확인한다.
- 결과는 HMAC 서명된 `POST /api/checks`로 전달한다.
- D1 batch는 두 구성요소의 상태 변경을 모두 반영하거나 모두 롤백한다.
- `GET /api/status` 성공 응답만 60초 동안 캐시한다.
- 원시 관측값 보존 기간은 35일이다.

- [ ] **Step 3: 상태, 가동률, 공지, 로컬 개발 설명을 자연스럽게 수정**

다음 치환 원칙을 적용한다.

- `Uptime과 coverage` → `가동률과 관측 범위`
- `sample` → `관측값`
- `slot` → `예정된 5분 관측 시각`
- `timezone` → `시간대`
- `token`, `provider`, `host`는 공개 금지 항목의 코드 용어이므로 백틱으로 표시한다.
- `local Worker binding`, `production D1`, `credential`, `custom domain`은 각각 `로컬 Worker binding`, `운영 D1`, `인증정보`, `사용자 지정 도메인`으로 쓴다.

배포 안내는 현재 상태와 충돌하지 않도록 다음 의미로 정리한다.

- `wrangler.jsonc`에는 공개 가능한 운영 D1 식별자와 사용자 지정 도메인만 있다.
- `STATUS_INGEST_SECRET` 값은 Cloudflare와 GitHub의 secret으로만 관리하며 저장소에 두지 않는다.
- `bun run cf:build`는 실제 배포가 아닌 dry run이다.

- [ ] **Step 4: README 회귀 검사와 저장소 검사를 실행**

Run:

```sh
bun -e '
import { readFile } from "node:fs/promises";
const text = await readFile("README.md", "utf8");
const failures = [
  [text.includes("[status.palate.one](https://status.palate.one/)"), "상태 페이지 링크"],
  [!text.includes("원시 sample"), "원시 sample"],
  [!text.includes("component 현재 상태"), "component 현재 상태"],
  [!text.includes("custom domain"), "custom domain"],
  [!text.includes("credential이나 secret"), "credential이나 secret"],
  [text.includes("/api/checks"), "/api/checks"],
  [text.includes("/api/status"), "/api/status"],
  [text.includes("up / (up + down)"), "가동률 계산식"],
  [text.includes("(up + down) / expected"), "관측 범위 계산식"],
];
const failed = failures.filter(([ok]) => !ok).map(([, label]) => label);
if (failed.length) throw new Error(`README 검증 실패: ${failed.join(", ")}`);
'
bun run conventions:test
git diff --check
```

Expected: one-shot 검사 PASS, convention 4 tests PASS, `git diff --check` 출력 없음.

- [ ] **Step 5: 의도한 README만 stage하고 커밋**

```sh
git status --short
git add README.md
git diff --cached --name-only
git diff --cached --check
git commit -m "DOCS: 상태 페이지 README 한국어 표현 정리" -m "- 어떤 작업을 했는가: 상태 페이지 목적과 구조를 자연스러운 한국어로 정리
- 어떤 이슈인가: 영어 혼용과 배포 전 표현 때문에 현재 운영 상태를 이해하기 어려움
- 그래서 무엇을 했는가: 기술 사실과 명령을 유지하면서 링크, 용어, 운영 환경 설명을 현재 상태로 수정"
```

Expected: staged file은 `README.md` 하나다.

---

### Task 2: CONTRIBUTING을 행동 중심의 자연스러운 한국어로 정리

**Files:**
- Modify: `CONTRIBUTING.md`
- Test: one-shot Bun 문서 회귀 검사

**Interfaces:**
- Consumes: `docs/incident-template.md`, `docs/maintenance-template.md`, content 경로, 저장소 commit/PR convention
- Produces: 공지, 점검, runtime, workflow, migration, Wrangler 설정 변경자가 그대로 따라 할 수 있는 기여 절차

- [ ] **Step 1: 현재 문구를 잡는 회귀 검사를 작성하고 실패 확인**

```sh
bun -e '
import { readFile } from "node:fs/promises";
const text = await readFile("CONTRIBUTING.md", "utf8");
const failures = [
  [text.startsWith("# 기여 안내"), "한국어 제목"],
  [!text.includes("작은 pull request"), "작은 pull request"],
  [!text.includes("raw provider payload"), "raw provider payload"],
  [!text.includes("commit 전"), "commit 전"],
  [!text.includes("혼합 worktree"), "혼합 worktree"],
];
const failed = failures.filter(([ok]) => !ok).map(([, label]) => label);
if (failed.length) throw new Error(`자연스러운 한국어 개편 필요: ${failed.join(", ")}`);
'
```

Expected: FAIL. 영어 제목과 혼용 표현이 남아 있어야 한다.

- [ ] **Step 2: 제목과 공지·점검 작성 절차를 행동 중심으로 수정**

다음 원칙을 적용한다.

- 제목은 `# 기여 안내`로 바꾼다.
- `pull request`는 일반 문장에서는 `PR`로 쓴다.
- `runtime`, `workflow`, `migration`은 각각 `실행 코드`, `GitHub Actions workflow`, `migration`으로 문맥을 분명히 한다.
- 장애 상태와 점검 상태의 코드 값은 백틱으로 유지한다.
- `filename slug`는 `파일 이름의 slug`로, `timezone`은 `시간대`로 쓴다.
- 주간 archive는 `주간 기록`으로 설명하되 실제 경로와 workflow 명칭은 유지한다.

- [ ] **Step 3: 안전 규칙, 검증, commit·PR 설명을 자연스럽게 수정**

다음 의미를 유지한다.

- `component` 필드에는 `web`, `api`만 허용한다.
- token, secret, 사용자 데이터, 내부 host, provider 원문은 commit하지 않는다.
- monitor target, HMAC endpoint, signature contract 변경은 보안 경계 변경이다.
- migration은 append-only이며 이미 배포된 파일을 수정하지 않는다.
- 생성된 `worker-configuration.d.ts`는 Wrangler 결과 그대로 유지한다.
- 콘텐츠 변경과 실행 코드·workflow·설정 변경의 검증 명령은 기존과 동일하다.
- commit 전에 status, staged file 목록, staged diff 검사를 확인하고 혼합된 작업 트리에서 `git add -A`를 쓰지 않는다.

일반 문장의 영어는 줄이되 코드와 Git 개념인 commit, PR, workflow, migration, staged file, worktree는 백틱으로 구분하거나 문맥상 익숙한 표기로 유지한다.

- [ ] **Step 4: CONTRIBUTING 회귀 검사와 교차 문서 보안 검사를 실행**

Run:

```sh
bun -e '
import { readFile } from "node:fs/promises";
const text = await readFile("CONTRIBUTING.md", "utf8");
const failures = [
  [text.startsWith("# 기여 안내"), "한국어 제목"],
  [!text.includes("작은 pull request"), "작은 pull request"],
  [!text.includes("raw provider payload"), "raw provider payload"],
  [!text.includes("commit 전"), "commit 전"],
  [!text.includes("혼합 worktree"), "혼합 worktree"],
  [text.includes("content/incidents/inc-YYYY-MM-DD-short-slug.md"), "장애 공지 경로"],
  [text.includes("content/maintenance/maint-YYYY-MM-DD-short-slug.md"), "점검 일정 경로"],
  [text.includes("bun run cf:build"), "Worker dry-run 명령"],
];
const failed = failures.filter(([ok]) => !ok).map(([, label]) => label);
if (failed.length) throw new Error(`CONTRIBUTING 검증 실패: ${failed.join(", ")}`);
'
if rg -n 'gh[pousr]_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|Bearer[[:space:]]+[A-Za-z0-9._~+/-]{20,}|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}' README.md CONTRIBUTING.md; then
  printf '공개 문서에서 비공개 값으로 의심되는 문자열을 찾았습니다.\n' >&2
  exit 1
fi
bun run conventions:test
git diff --check
```

Expected: one-shot 검사 PASS, 민감정보 의심 문자열 없음, convention 4 tests PASS, `git diff --check` 출력 없음.

- [ ] **Step 5: 의도한 CONTRIBUTING만 stage하고 커밋**

```sh
git status --short
git add CONTRIBUTING.md
git diff --cached --name-only
git diff --cached --check
git commit -m "DOCS: 기여 안내 한국어 표현 정리" -m "- 어떤 작업을 했는가: 공지, 점검, 코드 변경 절차를 자연스러운 한국어로 정리
- 어떤 이슈인가: 영어 혼용과 딱딱한 표현 때문에 기여 절차를 빠르게 파악하기 어려움
- 그래서 무엇을 했는가: 경로, 명령, 보안 규칙을 유지하면서 행동 순서와 용어를 명확하게 수정"
```

Expected: staged file은 `CONTRIBUTING.md` 하나다.

---

### Task 3: 교차 문서 최종 검증과 PR 준비

**Files:**
- Verify: `README.md`
- Verify: `CONTRIBUTING.md`
- Verify: `docs/superpowers/specs/2026-08-10-korean-project-guides-design.md`

**Interfaces:**
- Consumes: Task 1과 Task 2의 문서 결과
- Produces: 공개 저장소에 올릴 수 있는 검증된 문서 branch

- [ ] **Step 1: 링크 대상과 핵심 경로가 존재하는지 확인**

```sh
test -f docs/incident-template.md
test -f docs/maintenance-template.md
test -d content/incidents
test -d content/maintenance
test -d content/uptime
rg -n 'https://status\.palate\.one/|/api/checks|/api/status|docs/incident-template\.md|docs/maintenance-template\.md' README.md CONTRIBUTING.md
```

Expected: 모든 `test`가 종료 코드 0, `rg`가 README와 CONTRIBUTING의 실제 경로를 출력한다.

- [ ] **Step 2: 전체 문서·저장소 검증 실행**

```sh
bun run conventions:test
bun run test -- scripts/public-config.test.ts scripts/workflow-security.test.ts
bun run build
git diff main...HEAD --check
git status --short
```

Expected: convention 4 tests PASS, focused tests PASS, Astro build PASS, diff 오류와 작업 트리 변경 없음.

- [ ] **Step 3: commit 범위와 공개정보를 최종 확인**

```sh
git log --format='%H %s' main..HEAD
git diff --name-only main...HEAD
if git diff main...HEAD -- README.md CONTRIBUTING.md | rg 'gh[pousr]_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|Bearer[[:space:]]+[A-Za-z0-9._~+/-]{20,}|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}'; then
  printf '공개 diff에서 비공개 값으로 의심되는 문자열을 찾았습니다.\n' >&2
  exit 1
fi
```

Expected: spec, plan, README, CONTRIBUTING 관련 commit과 파일만 보이고 민감정보 의심 문자열은 없다.

- [ ] **Step 4: 한국어 PR 작성**

PR 제목:

```text
DOCS: 상태 저장소 한국어 안내 문서 정리
```

PR 본문에는 저장소 template의 8개 heading을 모두 유지하고 다음 내용을 포함한다.

- Why: 공개 저장소의 역할과 기여 절차를 더 빠르게 이해하도록 한다.
- Scope: README와 CONTRIBUTING 문체·현재 운영 상태만 수정한다.
- Risks: 명령이나 보안 경계가 누락될 수 있어 one-shot 검사와 diff로 확인했다.
- Validation: convention, focused public config/workflow security tests, Astro build, 공개정보 검사 결과를 적는다.
- Known Issues: 코드, 화면 문구, 배포 자동화는 바꾸지 않았다.
