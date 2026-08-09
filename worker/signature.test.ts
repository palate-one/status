import { describe, expect, it } from "vitest";

import { signBody, verifySignedBody } from "./signature";

const SECRET = "test-only-status-ingestion-secret";
const NOW = new Date("2026-08-09T12:00:00Z");
const TIMESTAMP = String(NOW.getTime() / 1_000);
const RAW_BODY = '{"version":1,"scheduledAt":"2026-08-09T11:58:00Z"}';

async function verify(overrides: Partial<Parameters<typeof verifySignedBody>[0]> = {}) {
  const signature = await signBody(SECRET, TIMESTAMP, RAW_BODY);
  return verifySignedBody({
    secret: SECRET,
    timestamp: TIMESTAMP,
    rawBody: RAW_BODY,
    signature,
    now: NOW,
    ...overrides,
  });
}

describe("signed status ingestion", () => {
  it("accepts the exact HMAC over timestamp and raw body", async () => {
    const signature = await signBody(SECRET, TIMESTAMP, RAW_BODY);

    expect(signature).toMatch(/^sha256=[0-9a-f]{64}$/);
    await expect(verify({ signature })).resolves.toBe(true);
  });

  it("rejects a one-byte body change", async () => {
    await expect(verify({ rawBody: `${RAW_BODY} ` })).resolves.toBe(false);
  });

  it.each([
    ["malformed hexadecimal", "sha256=not-hex"],
    ["wrong digest length", "sha256=00"],
    ["uppercase digest", `sha256=${"A".repeat(64)}`],
    ["valid-length wrong digest", `sha256=${"0".repeat(64)}`],
  ])("rejects %s through the fixed-length comparison path", async (_case, signature) => {
    await expect(verify({ signature })).resolves.toBe(false);
  });

  it.each([
    ["past", new Date(NOW.getTime() - 301_000)],
    ["future", new Date(NOW.getTime() + 301_000)],
  ])("rejects a timestamp more than 300 seconds in the %s", async (_case, signedAt) => {
    const timestamp = String(signedAt.getTime() / 1_000);
    const signature = await signBody(SECRET, timestamp, RAW_BODY);

    await expect(verify({ timestamp, signature })).resolves.toBe(false);
  });

  it.each([-300, 300])("accepts the inclusive %i-second freshness boundary", async (offset) => {
    const signedAt = new Date(NOW.getTime() + offset * 1_000);
    const timestamp = String(signedAt.getTime() / 1_000);
    const signature = await signBody(SECRET, timestamp, RAW_BODY);

    await expect(verify({ timestamp, signature })).resolves.toBe(true);
  });
});
