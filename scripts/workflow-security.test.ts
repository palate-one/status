import { readdir, readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const APPROVED_ACTION_DIGESTS = new Map([
  ["actions/checkout", "d23441a48e516b6c34aea4fa41551a30e30af803"],
  ["oven-sh/setup-bun", "0c5077e51419868618aeaa5fe8019c62421857d6"],
]);

describe("workflow supply-chain controls", () => {
  it("pins every GitHub Action to a reviewed immutable digest", async () => {
    const workflowDirectory = ".github/workflows";
    const workflowNames = (await readdir(workflowDirectory)).filter((name) =>
      name.endsWith(".yml"),
    );

    for (const workflowName of workflowNames) {
      const workflow = await readFile(`${workflowDirectory}/${workflowName}`, "utf8");
      const references = [...workflow.matchAll(/^\s*uses:\s+([^@\s]+)@([^\s#]+)/gm)];

      expect(references.length, workflowName).toBeGreaterThan(0);
      for (const [, action, digest] of references) {
        expect(digest, `${workflowName}: ${action}`).toBe(
          APPROVED_ACTION_DIGESTS.get(action),
        );
      }
    }
  });
});
