#!/usr/bin/env node

import { formatErrors, validatePullRequestBody } from "./lib/repo-conventions.mjs";

const result = validatePullRequestBody(process.env.PR_BODY ?? "");

if (!result.ok) {
  console.error(formatErrors("PR 본문 템플릿 규칙 위반", result.errors));
  process.exit(1);
}
