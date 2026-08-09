import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("status page build", () => {
  it("builds one integrated service status section with two 30-day placeholder rails", async () => {
    execFileSync("bun", ["run", "build"], {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: "pipe",
    });

    const html = await readFile("dist/index.html", "utf8");
    expect(html).toContain("서비스 상태와 최근 30일 가동률");
    expect((html.match(/data-component-id=/g) ?? []).length).toBe(2);
    expect((html.match(/data-uptime-placeholder/g) ?? []).length).toBe(60);
    expect(html).toContain('data-uptime-placeholder aria-hidden="true"');
    expect(html).toContain("측정 데이터 없음");
    expect(html).not.toContain("Read uptime graph for undefined");
  });

  it("uses the readable muted token for the small uptime note", async () => {
    const css = await readFile("src/styles/global.css", "utf8");
    const noteRule = css.match(/\.uptime-note\s*\{([^}]*)\}/)?.[1] ?? "";

    expect(noteRule).toContain("color: var(--text-muted);");
    expect(noteRule).not.toContain("var(--text-faint)");
  });
});
