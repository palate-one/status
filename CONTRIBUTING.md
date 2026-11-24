# 기여 안내

변경은 작고 목적이 분명한 PR로 제출한다. 실행 코드, GitHub Actions workflow, migration, Wrangler 설정을 바꿀 때는 관련 테스트 결과와 운영 영향을 함께 설명한다.

## 장애 공지 작성

1. `docs/incident-template.md`를 `content/incidents/inc-YYYY-MM-DD-short-slug.md`로 복사한다.
2. 템플릿의 예시 값을 모두 바꾸고, `id`와 파일 이름의 slug를 맞춘다.
3. `investigating -> identified -> monitoring -> resolved` 흐름에서 현재 상태만 기록한다.
4. 상태가 `resolved`라면 시간대가 포함된 `resolvedAt`을 입력한다.
5. 본문에는 발생 시각, 확인된 사용자 영향, 현재 조치만 적는다.

## 점검 일정 작성

1. `docs/maintenance-template.md`를 `content/maintenance/maint-YYYY-MM-DD-short-slug.md`로 복사한다.
2. `scheduled`, `in_progress`, `completed`, `cancelled` 중 현재 상태를 입력한다.
3. `endsAt`이 있다면 `startsAt`보다 늦어야 한다. 상태가 `completed`라면 실제 `endsAt`이 필요하다.
4. 예상 사용자 영향과 완료 또는 취소 결과는 확인된 사실만 공개한다.

`content/uptime/YYYY-Www.json` 주간 기록은 전용 workflow가 생성한다. 직접 수정하거나 기존 파일을 덮어쓰지 않는다.

## 안전 규칙

- `component` 필드에는 `web`, `api`만 사용한다.
- `token`, `secret`, 사용자 데이터, 내부 `host`, `provider` 원문은 커밋하지 않는다.
- 모니터 대상과 예약 시각, 알림 경로 변경은 보안 경계 변경으로 취급한다.
- `migration`은 새 파일로만 추가한다. 이미 배포된 파일은 수정하지 않는다.
- 생성된 `worker-configuration.d.ts`는 `bunx wrangler types`가 만든 결과 그대로 유지한다.

## 검증

콘텐츠 변경:

```sh
bun run test -- src/status/content-schema.test.ts src/status/content-build.test.ts
bun run build
git diff --check
```

실행 코드, GitHub Actions workflow, Wrangler 설정 변경:

```sh
bun install --frozen-lockfile
bun run check
bun run test
bun run build
bun run cf:build
git diff --check
```

## 커밋과 PR

Palate 저장소와 같은 작성 규칙을 사용한다. 커밋 제목은 허용된 대문자 타입과 한국어 요약으로 작성하고, 본문에는 다음 세 항목을 모두 적는다.

```text
CHORE: 운영 D1 연결

- 어떤 작업을 했는가: 공개 상태 Worker의 D1 binding 연결
- 어떤 이슈인가: 운영 환경 배포 준비
- 그래서 무엇을 했는가: 실제 D1 식별자와 공개 설정 회귀 검증 추가
```

PR은 한국어로 작성하고 저장소 템플릿의 8개 제목을 모두 유지한다. 검증 결과, 알려진 문제, 선택한 절충점, 다음 단계를 숨기지 않는다.

커밋하기 전에 `git status --short`, stage에 올라간 파일 목록, `git diff --cached --check`를 확인한다. 여러 변경이 섞인 작업 트리에서는 `git add -A`를 사용하지 않는다.
