# Security Policy

## 취약점 제보

공개 issue에 취약점 상세나 재현용 민감 정보를 쓰지 않는다. 저장소에 GitHub의 **Report a vulnerability** 기능이 활성화되어 있으면 그 private channel을 사용한다. 사용할 수 없다면 Palate maintainer와 이미 합의된 private channel로 최소 정보만 전달한다.

제보에는 영향받는 경로, 예상 영향, 안전하게 축약한 재현 절차를 포함한다. 실제 token, 사용자 데이터, 운영 request body는 첨부하지 않는다.

## 공개 금지 정보

issue, pull request, commit, workflow log, incident/maintenance content에 다음 정보를 공개하지 않는다.

- access token, refresh token, HMAC secret, session, cookie, API key
- email, OAuth subject, passkey credential ID, 내부 user ID
- private note, 정확한 GPS, private media path나 read token
- 내부 host, private object key, 비공개 운영 식별자
- raw provider payload, request/response body, 서명 header
- 실제 사용자 또는 운영 데이터를 포함한 screenshot과 log

노출이 의심되면 값을 다시 게시하거나 검증하려 하지 말고 즉시 해당 secret을 폐기·회전한 뒤 private channel로 범위와 시각을 전달한다.

## 공개 상태 콘텐츠

장애와 점검 공지는 사용자 영향과 확인된 공개 사실만 담는다. 원인이 확정되지 않았으면 추측하지 않는다. 개인 데이터나 내부 식별자는 삭제가 아니라 처음부터 포함하지 않는다.

보안 수정은 generic public error, 고정된 endpoint/host allowlist, HMAC 검증, replay idempotency, D1 query bound를 약화시키지 않아야 한다.
