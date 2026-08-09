#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { formatErrors, validateCommitMessage } from "./lib/repo-conventions.mjs";

const messagePath = process.argv[2];

if (!messagePath) {
  console.error("Usage: bun scripts/validate-commit-message.mjs <commit-message-file>");
  process.exit(2);
}

const result = validateCommitMessage(readFileSync(messagePath, "utf8"));

if (!result.ok) {
  console.error(formatErrors("커밋 메시지 규칙 위반", result.errors));
  process.exit(1);
}
