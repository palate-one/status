export const allowedCommitTypes = new Set([
  "FEAT",
  "FIX",
  "CHORE",
  "DOCS",
  "TEST",
  "REFACTOR",
  "STYLE",
  "PERF",
  "BUILD",
  "CI",
  "REVERT",
]);

export const requiredCommitBodyFields = [
  "어떤 작업을 했는가",
  "어떤 이슈인가",
  "그래서 무엇을 했는가",
];

export const requiredPullRequestHeadings = [
  "## 1. Why - 이 PR을 왜 머지해야 하는가",
  "## 2. Scope - 이 PR이 다루는 범위",
  "## 3. Changes & Structure - 무엇을 어떻게 바꿨는가",
  "## 4. Side Effects & Risks - 사이드 이펙트와 리스크",
  "## 5. Validation - 최소 검증 수준",
  "## 6. Known Issues & Trade-offs - 알지만 남겨둔 문제들",
  "## 7. Next Steps - 다음에 해야 할 일",
  "## 8. Review Notes (선택)",
];

export function cleanCommitMessage(rawMessage) {
  return rawMessage
    .replaceAll("\r\n", "\n")
    .split("\n")
    .filter((line) => !line.startsWith("#"))
    .join("\n")
    .trim();
}

export function validateCommitMessage(rawMessage) {
  const message = cleanCommitMessage(rawMessage);
  const lines = message.split("\n");
  const subject = lines[0]?.trim() ?? "";
  const errors = [];
  const subjectMatch = subject.match(/^([A-Z]+):\s+.+/);

  if (!subjectMatch) {
    errors.push("커밋 제목은 `TYPE: 작업 요약` 형식이어야 합니다.");
  } else if (!allowedCommitTypes.has(subjectMatch[1])) {
    errors.push(
      `커밋 타입은 ${Array.from(allowedCommitTypes).join(", ")} 중 하나여야 합니다.`,
    );
  }

  if (lines.length < 3 || lines[1]?.trim() !== "") {
    errors.push("커밋 제목과 본문 사이에는 빈 줄이 있어야 합니다.");
  }

  for (const field of requiredCommitBodyFields) {
    if (!message.includes(`- ${field}:`)) {
      errors.push(`커밋 본문에 \`- ${field}:\` 항목이 필요합니다.`);
    }
  }

  return { errors, ok: errors.length === 0 };
}

export function validatePullRequestBody(rawBody) {
  const body = (rawBody ?? "").replaceAll("\r\n", "\n").trim();
  const errors = [];

  if (!body) {
    errors.push("PR 본문이 비어 있습니다.");
  }

  for (const heading of requiredPullRequestHeadings) {
    if (!body.includes(heading)) {
      errors.push(`PR 본문에 \`${heading}\` 섹션이 필요합니다.`);
    }
  }

  return { errors, ok: errors.length === 0 };
}

export function formatErrors(title, errors) {
  return [`${title}:`, ...errors.map((error) => `- ${error}`)].join("\n");
}
