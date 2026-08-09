# Contributing

변경은 작은 pull request로 제출한다. runtime, workflow, migration, Wrangler 설정 변경은 관련 테스트와 운영 영향 설명이 필요하다.

## 장애 공지

1. `docs/incident-template.md`를 `content/incidents/inc-YYYY-MM-DD-short-slug.md`로 복사한다.
2. placeholder를 모두 바꾸고 `id`와 filename slug를 맞춘다.
3. `investigating -> identified -> monitoring -> resolved` 흐름에서 현재 상태만 기록한다.
4. `resolved`이면 timezone을 포함한 `resolvedAt`을 넣는다.
5. 본문에는 시각, 확인된 사용자 영향, 현재 조치만 쓴다.

## 점검 일정

1. `docs/maintenance-template.md`를 `content/maintenance/maint-YYYY-MM-DD-short-slug.md`로 복사한다.
2. `scheduled`, `in_progress`, `completed`, `cancelled` 중 현재 상태를 쓴다.
3. `endsAt`이 있으면 `startsAt`보다 늦어야 한다. `completed`에는 실제 `endsAt`이 필요하다.
4. 예상 사용자 영향과 완료 또는 취소 결과를 공개 사실로만 쓴다.

주간 `content/uptime/YYYY-Www.json`은 archive workflow가 생성한다. 수동 수정하거나 기존 파일을 덮어쓰지 않는다.

## 안전 규칙

- component는 `web`, `api`만 사용한다.
- token, secret, 사용자 데이터, 내부 host, raw provider payload를 commit하지 않는다.
- monitor target, HMAC endpoint, signature contract 변경은 보안 경계 변경으로 취급한다.
- migration은 append-only로 추가한다. 이미 배포된 migration을 다시 쓰지 않는다.
- 생성된 `worker-configuration.d.ts`는 `bunx wrangler types` 결과 그대로 유지한다.

## 검증

콘텐츠 변경:

```sh
bun run test -- src/status/content-schema.test.ts src/status/content-build.test.ts
bun run build
git diff --check
```

runtime, workflow, config 변경:

```sh
bun install --frozen-lockfile
bun run check
bun run test
bun run build
bun run cf:build
git diff --check
```

## Commit과 pull request

Palate 저장소와 같은 convention을 사용한다. commit 제목은 허용된 대문자 type과 한국어 요약을 사용하고 본문 세 항목을 모두 적는다.

```text
CHORE: production D1 연결

- 어떤 작업을 했는가: 공개 상태 Worker의 D1 binding 연결
- 어떤 이슈인가: production 배포 준비
- 그래서 무엇을 했는가: 실제 D1 식별자와 공개 설정 회귀 검증 추가
```

PR은 한국어로 작성하고 repository template의 8개 heading을 모두 유지한다. validation, known issue, trade-off와 next step을 숨기지 않는다.

commit 전 `git status --short`, staged file 목록, `git diff --cached --check`를 확인한다. 혼합 worktree에서 `git add -A`를 사용하지 않는다.
