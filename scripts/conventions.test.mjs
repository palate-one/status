import { describe, expect, test } from "bun:test";
import {
  requiredPullRequestHeadings,
  validateCommitMessage,
  validatePullRequestBody,
} from "./lib/repo-conventions.mjs";

describe("commit message conventions", () => {
  test("accepts the Palate Korean commit format", () => {
    const result = validateCommitMessage(`CI: PR 검증 워크플로 보강

- 어떤 작업을 했는가: 저장소 convention 검사 추가
- 어떤 이슈인가: 공개 상태 저장소 운영 규칙 통일
- 그래서 무엇을 했는가: commit과 PR 검증을 CI에 연결`);

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  test("rejects lowercase subjects and missing body fields", () => {
    const result = validateCommitMessage("add comprehensive ci checks");

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      "커밋 제목은 `TYPE: 작업 요약` 형식이어야 합니다.",
    );
    expect(result.errors).toContain(
      "커밋 본문에 `- 어떤 작업을 했는가:` 항목이 필요합니다.",
    );
  });
});

describe("pull request body conventions", () => {
  test("accepts all eight Palate PR headings", () => {
    const body = requiredPullRequestHeadings
      .map((heading) => `${heading}\n- 검증용 본문`)
      .join("\n\n");

    expect(validatePullRequestBody(body).ok).toBe(true);
  });

  test("rejects a body missing the Palate PR headings", () => {
    const result = validatePullRequestBody("## Summary\n- 내용");

    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain("## 1. Why");
  });
});
