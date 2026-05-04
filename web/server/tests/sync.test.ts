import { describe, it, expect } from "vitest";
import {
  parseApplicationsMd,
  serializeApplicationsMd,
  parsePortalsYml,
} from "../src/modules/sync/parsers.js";

describe("parseApplicationsMd", () => {
  it("parses a well-formed applications.md table", () => {
    const md = `# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
| 1 | 2026-04-01 | Acme Corp | AI Engineer | 4.2/5 | Applied | ✅ | [1](reports/001-acme-corp-2026-04-01.md) | Strong fit |
| 2 | 2026-04-05 | Globex | ML Lead | 3.8/5 | Evaluated | ❌ | [2](reports/002-globex-2026-04-05.md) | Needs review |
`;

    const result = parseApplicationsMd(md);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      number: 1,
      date: "2026-04-01",
      company: "Acme Corp",
      role: "AI Engineer",
      score: "4.2",
      status: "Applied",
      pdfGenerated: true,
      reportPath: "reports/001-acme-corp-2026-04-01.md",
      notes: "Strong fit",
    });
    expect(result[1]).toEqual({
      number: 2,
      date: "2026-04-05",
      company: "Globex",
      role: "ML Lead",
      score: "3.8",
      status: "Evaluated",
      pdfGenerated: false,
      reportPath: "reports/002-globex-2026-04-05.md",
      notes: "Needs review",
    });
  });

  it("returns empty array for empty or header-only table", () => {
    const md = `# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
`;
    expect(parseApplicationsMd(md)).toEqual([]);
  });

  it("handles missing notes column", () => {
    const md = `# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
| 1 | 2026-04-01 | TestCo | Dev | 3.5/5 | Evaluated | ❌ | [1](reports/001-testco-2026-04-01.md) |  |
`;
    const result = parseApplicationsMd(md);
    expect(result[0].notes).toBe("");
  });
});

describe("serializeApplicationsMd", () => {
  it("round-trips: parse then serialize produces equivalent markdown", () => {
    const original = `# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
| 1 | 2026-04-01 | Acme Corp | AI Engineer | 4.2/5 | Applied | ✅ | [1](reports/001-acme-corp-2026-04-01.md) | Strong fit |
| 2 | 2026-04-05 | Globex | ML Lead | 3.8/5 | Evaluated | ❌ | [2](reports/002-globex-2026-04-05.md) | Needs review |
`;
    const parsed = parseApplicationsMd(original);
    const serialized = serializeApplicationsMd(parsed);
    const reparsed = parseApplicationsMd(serialized);

    expect(reparsed).toEqual(parsed);
  });
});

describe("parsePortalsYml", () => {
  it("parses tracked companies into source records", () => {
    const yml = `
title_filter:
  positive: ["AI", "ML"]
  negative: ["Junior"]

tracked_companies:
  - name: OpenAI
    careers_url: https://jobs.ashbyhq.com/openai
    enabled: true
  - name: Anthropic
    api: https://boards-api.greenhouse.io/v1/boards/anthropic/jobs
    enabled: false
`;

    const result = parsePortalsYml(yml);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      name: "OpenAI",
      type: "ashby",
      config: {
        careers_url: "https://jobs.ashbyhq.com/openai",
        title_filter: { positive: ["AI", "ML"], negative: ["Junior"] },
      },
      enabled: true,
    });
    expect(result[1]).toEqual({
      name: "Anthropic",
      type: "greenhouse",
      config: {
        api: "https://boards-api.greenhouse.io/v1/boards/anthropic/jobs",
        title_filter: { positive: ["AI", "ML"], negative: ["Junior"] },
      },
      enabled: false,
    });
  });
});
