#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { formatErrors, validateCommitMessage } from "./lib/repo-conventions.mjs";

const range = process.argv[2] ?? "HEAD";
const hashes = execFileSync("git", ["rev-list", "--reverse", range], {
  encoding: "utf8",
})
  .trim()
  .split("\n")
  .filter(Boolean);

const failures = [];

for (const hash of hashes) {
  const message = execFileSync("git", ["log", "-1", "--format=%B", hash], {
    encoding: "utf8",
  });
  const result = validateCommitMessage(message);
  if (!result.ok) {
    failures.push(
      `${hash.slice(0, 12)}\n${formatErrors("커밋 메시지 규칙 위반", result.errors)}`,
    );
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n\n"));
  process.exit(1);
}
