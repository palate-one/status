# Palate Status

`status.palate.one`의 공개 상태 페이지와 Web/API 가동률 기록 저장소다. 상태 화면은 한국어로 제공한다. 장애 공지와 점검 일정은 이 저장소의 공개 Markdown으로 관리한다.

## 구조

```text
GitHub Actions monitor (5분)
  -> Web / API 공개 health 확인
  -> HMAC 서명 POST /api/checks
  -> Cloudflare Worker
  -> D1 sample, component state, daily aggregate
  -> GET /api/status
  -> Astro 정적 페이지 hydration

GitHub Markdown
  -> content/incidents, content/maintenance
  -> Astro build

D1 daily aggregate
  -> Monday archive workflow
  -> content/uptime/YYYY-Www.json
```

- Astro는 공개 페이지, 404 페이지, 공지와 점검 이력을 정적으로 빌드한다.
- Worker는 `/api/checks`, `/api/status`만 먼저 처리하고 나머지는 Static Assets로 전달한다.
- D1은 원시 sample 35일, component 현재 상태, UTC 일별 aggregate를 저장한다.
- 외부 monitor는 `palate.one`과 `api.palate.one/readyz`만 검사한다. 결과는 두 component를 한 서명 본문으로 전송한다.
- 주간 archive는 끝난 ISO week만 공개 JSON으로 저장한다. 이미 존재하는 archive는 덮어쓰지 않는다.

## 상태 기준

| 공개 상태 | 의미 |
| --- | --- |
| `정상` | 최근 관측이 성공했다. |
| `문제 발생` | 같은 component에서 연속 두 번 실패했다. |
| `상태 확인 불가` | 관측이 없거나 마지막 관측 후 15분을 초과했다. |

한 번 성공하면 해당 component는 즉시 복구된다. Web 또는 API 하나가 `문제 발생`이면 전체 상태도 `서비스 문제 발생`이다. 장애와 관측 불가가 섞이면 장애를 숨기지 않는다.

## Uptime과 coverage

- uptime은 관측된 sample 중 성공 비율이다: `up / (up + down)`.
- coverage는 예정된 5분 slot 중 실제 관측된 비율이다: `(up + down) / expected`.
- 누락된 slot은 장애로 계산하지 않고 coverage만 낮춘다.
- 관측 sample이 없으면 uptime은 `측정 데이터 없음`이다. 가짜 100%를 만들지 않는다.

## 장애 공지와 점검 일정

장애 공지는 `content/incidents/inc-YYYY-MM-DD-slug.md`, 점검 일정은 `content/maintenance/maint-YYYY-MM-DD-slug.md`에 작성한다. 각각 [incident template](docs/incident-template.md), [maintenance template](docs/maintenance-template.md)을 복사한다.

- 확인된 사용자 영향만 공개한다.
- 시간은 timezone이 포함된 RFC 3339를 쓴다.
- component는 `web`, `api`만 허용한다.
- 해결된 장애는 `resolvedAt`, 완료된 점검은 `endsAt`이 필요하다.
- token, 내부 host, 사용자 데이터, provider 원문은 쓰지 않는다.

자세한 절차와 검증 명령은 [CONTRIBUTING.md](CONTRIBUTING.md)를 따른다.

## 로컬 개발

요구 사항: Bun 1.3.12, Node.js 호환 도구, Cloudflare Wrangler.

```sh
bun install --frozen-lockfile
bunx wrangler d1 migrations apply palate-status --local
STATUS_INGEST_SECRET="$(openssl rand -hex 32)" bun run dev
```

주요 검증:

```sh
bun run check
bun run test
bun run build
bun run cf:build
git diff --check
```

`bun run cf:build`는 dry run이다. `wrangler.jsonc`의 all-zero D1 ID는 로컬 전용 sentinel이라 실제 배포 준비가 아니다. 실제 D1 ID, secret, custom domain, Workers Builds 연결은 별도 운영 단계에서 검증한다.

## 무료 운영 경계

구성은 공개 저장소의 GitHub Actions와 Cloudflare Workers/D1 무료 사용량 안에서 운영하는 것을 목표로 한다. 5분 schedule은 하루 최대 288번 실행된다. 다만 GitHub schedule은 정확한 실행 시각 SLA가 아니며, Cloudflare 무료 사용량은 account 전체에서 공유된다. 배포 전에 현재 공식 한도와 account 사용량을 다시 확인해야 한다.

Workers Builds의 build/deploy command와 watch path는 Cloudflare dashboard 설정이다. Wrangler의 custom build 설정만으로 대체되지 않는다. 주간 archive-only commit의 build 제외가 정확히 지원되지 않으면 주 1회 build를 허용하고 임의 diff script를 추가하지 않는다.

## 증거 경계

다음 상태는 서로 다르다.

1. local code와 test 통과
2. commit 생성
3. remote push
4. GitHub CI/workflow 성공
5. Cloudflare build와 deploy 성공
6. D1 migration/binding 확인
7. custom domain/TLS 확인
8. 실제 monitor failure/recovery E2E

앞 단계의 성공만으로 뒤 단계가 완료됐다고 판단하지 않는다.
