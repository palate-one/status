# Palate Status

[status.palate.one](https://status.palate.one/)에서 Palate Web과 API의 현재 상태와 최근 가동률을 확인할 수 있다. 장애 공지와 점검 일정은 이 공개 저장소의 Markdown 문서로 관리한다.

## 구조

```text
Cloudflare Worker Cron Trigger (5분 간격)
  -> Web / API 공개 상태 확인
  -> D1 관측값 batch, 구성요소 상태, 일별 집계, 공개 상태 스냅샷
  -> GET /api/status
  -> 캐시 미스 rate limit + 60초 Cache API
  -> Astro 정적 페이지의 브라우저 상태 갱신

GitHub Markdown
  -> content/incidents, content/maintenance
  -> Astro build

D1 일별 집계
  -> 월요일 주간 기록 workflow
  -> content/uptime/YYYY-Www.json
```

- Astro는 공개 상태 페이지와 404 페이지, 장애 공지, 점검 이력을 정적으로 빌드한다.
- Worker는 `/api/status`를 먼저 처리하고, 나머지 요청은 Static Assets로 전달한다.
- D1은 원시 관측값을 35일 동안 보관한다. 현재 구성요소 상태, UTC 일별 집계, 최초 관측 시각, 최근 35일의 공개 상태 스냅샷도 함께 관리한다.
- Cron Trigger는 매시 3분부터 5분마다 `palate.one`과 `api.palate.one/readyz`만 확인한다. `global_fetch_strictly_public`을 켜서 같은 zone의 요청도 공개 경로로 나간다. D1 batch는 관측값, 상태, 집계, 공개 상태 스냅샷을 모두 반영하거나 모두 롤백한다.
- `정상`과 `문제 발생`이 바뀔 때만 Telegram으로 알린다. Worker secret `TELEGRAM_BOT_TOKEN`과 `TELEGRAM_CHAT_ID`가 없으면 관측은 저장하고 알림만 건너뛴다.
- 공개 상태 API는 쿼리 문자열이 있는 요청을 거부한다. 성공 응답만 데이터센터별 Cache API에 60초 동안 저장하고, 캐시 미스는 위치별로 분당 5회까지 허용한다. 캐시 미스 한 번은 D1의 공개 상태 스냅샷 한 행만 읽는다.
- 주간 기록은 끝난 ISO 주차만 공개 JSON으로 저장한다. 기존 기록은 덮어쓰지 않는다.

## 상태 기준

| 공개 상태 | 의미 |
| --- | --- |
| `정상` | 관측이 최신이고, 같은 구성요소가 연속 두 번 실패하지 않았다. |
| `문제 발생` | 같은 구성요소가 연속 두 번 실패했다. |
| `상태 확인 불가` | 관측 기록이 없거나 마지막 관측 후 15분이 지났다. |

한 번 성공하면 해당 구성요소는 즉시 복구된다. Web이나 API 중 하나라도 `문제 발생`이면 전체 상태도 `서비스 문제 발생`으로 표시한다. 장애와 관측 불가가 함께 발생해도 확인된 장애를 숨기지 않는다.

## 가동률과 관측 범위

- 가동률은 실제 관측값 중 성공 비율이다: `up / (up + down)`.
- 관측 범위는 예정된 5분 관측 시각 중 실제로 확인한 비율이다: `(up + down) / expected`.
- 누락된 관측은 장애로 계산하지 않고 관측 범위만 낮춘다.
- 관측값이 없으면 가동률을 `측정 데이터 없음`으로 표시한다. 임의로 100%를 만들지 않는다.

## 장애 공지와 점검 일정

장애 공지는 `content/incidents/inc-YYYY-MM-DD-slug.md`, 점검 일정은 `content/maintenance/maint-YYYY-MM-DD-slug.md`에 작성한다. [장애 공지 템플릿](docs/incident-template.md)과 [점검 일정 템플릿](docs/maintenance-template.md)을 복사해 사용한다.

- 확인된 사용자 영향만 공개한다.
- 시각은 시간대가 포함된 RFC 3339 형식으로 쓴다.
- `component` 필드에는 `web`, `api`만 사용할 수 있다.
- 해결된 장애에는 `resolvedAt`, 완료된 점검에는 `endsAt`이 필요하다.
- `token`, 내부 `host`, 사용자 데이터, `provider` 원문은 공개하지 않는다.

자세한 작성 절차와 검증 명령은 [기여 안내](CONTRIBUTING.md)에서 확인할 수 있다.

## 로컬 개발

Bun 1.3.12와 Node.js 호환 도구, Cloudflare Wrangler가 필요하다.

```sh
bun install --frozen-lockfile
bunx wrangler d1 migrations apply palate-status --local
bun run dev -- --test-scheduled
```

관측을 한 번 실행하려면 다른 터미널에서 `curl "http://localhost:8787/__scheduled?cron=3-58/5+*+*+*+*"`를 부른다. 예약 시각은 매시 3분부터 5분 간격이어야 D1에 저장된다.

주요 검증 명령:

```sh
bun run check
bun run test
bun run build
bun run cf:build
git diff --check
```

`bun run cf:build`는 실제로 배포하지 않는 dry run이다. `wrangler.jsonc`에는 공개 가능한 운영 D1 식별자와 사용자 지정 도메인만 있다. Telegram 값은 Cloudflare Worker의 secret으로만 관리하며 저장소에 두지 않는다.

## 무료 운영 경계

이 서비스는 Cloudflare Workers/D1의 무료 사용량 안에서 운영하는 것을 목표로 한다. Cron Trigger는 하루 288번 실행된다. GitHub `schedule`은 실행 시각을 보장하지 않고 60일 동안 변경이 없는 공개 저장소에서는 꺼지므로 관측에 쓰지 않는다. 주간 기록 workflow도 같은 이유로 꺼질 수 있다. Cloudflare 무료 사용량은 계정 전체에서 공유된다. Cache API와 Worker rate limit은 데이터센터별로 적용되고, rate limit은 일시적으로 완전히 일치하지 않을 수 있다. 배포 전에는 최신 공식 한도와 계정 사용량을 다시 확인해야 한다.

Workers Builds의 빌드·배포 명령과 감시 경로는 Cloudflare 대시보드에서 설정한다. Wrangler의 사용자 지정 빌드 설정만으로는 이를 대신할 수 없다. 주간 기록만 바뀐 커밋을 빌드에서 정확히 제외할 수 없다면 주 1회 빌드를 허용하고, 별도 diff script는 추가하지 않는다.

## 증거 경계

다음 단계는 서로 다른 완료 상태다.

1. 로컬 코드와 테스트 통과
2. 커밋 생성
3. 원격 저장소 push
4. GitHub CI 또는 workflow 성공
5. Cloudflare 빌드와 배포 성공
6. D1 migration과 binding 확인
7. 사용자 지정 도메인과 TLS 확인
8. 실제 모니터 장애·복구 E2E 확인

앞 단계가 성공했더라도 다음 단계까지 완료됐다고 판단하지 않는다.
