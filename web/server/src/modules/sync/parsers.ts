import yaml from "js-yaml";

export interface ParsedApplication {
  number: number;
  date: string;
  company: string;
  role: string;
  score: string | null;
  status: string;
  pdfGenerated: boolean;
  reportPath: string | null;
  notes: string;
}

export function parseApplicationsMd(md: string): ParsedApplication[] {
  const lines = md.split("\n");
  const results: ParsedApplication[] = [];

  for (const line of lines) {
    if (!line.startsWith("|")) continue;
    if (line.includes("---")) continue;

    const cells = line.split("|").map((s) => s.trim());
    const num = parseInt(cells[1]);
    if (isNaN(num) || num === 0) continue;

    const scoreRaw = cells[5] || "";
    const scoreMatch = scoreRaw.match(/([\d.]+)/);

    const reportRaw = cells[8] || "";
    const reportMatch = reportRaw.match(/\]\(([^)]+)\)/);

    results.push({
      number: num,
      date: cells[2] || "",
      company: cells[3] || "",
      role: cells[4] || "",
      score: scoreMatch ? scoreMatch[1] : null,
      status: cells[6] || "Evaluated",
      pdfGenerated: (cells[7] || "").includes("✅"),
      reportPath: reportMatch ? reportMatch[1] : null,
      notes: (cells[9] || "").trim(),
    });
  }

  return results;
}

export function serializeApplicationsMd(apps: ParsedApplication[]): string {
  const header = `# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|`;

  const rows = apps.map((a) => {
    const score = a.score ? `${a.score}/5` : "";
    const pdf = a.pdfGenerated ? "✅" : "❌";
    const report = a.reportPath ? `[${a.number}](${a.reportPath})` : "";
    return `| ${a.number} | ${a.date} | ${a.company} | ${a.role} | ${score} | ${a.status} | ${pdf} | ${report} | ${a.notes} |`;
  });

  return header + "\n" + rows.join("\n") + "\n";
}

interface ParsedSource {
  name: string;
  type: string;
  config: Record<string, unknown>;
  enabled: boolean;
}

export function parsePortalsYml(content: string): ParsedSource[] {
  const doc = yaml.load(content) as Record<string, unknown>;
  const companies = (doc.tracked_companies || []) as Record<string, unknown>[];
  const titleFilter = doc.title_filter || {};

  return companies.map((c) => {
    const careersUrl = (c.careers_url as string) || "";
    const api = (c.api as string) || "";
    let type = "custom";

    if (api.includes("greenhouse") || careersUrl.match(/greenhouse\.io/)) {
      type = "greenhouse";
    } else if (careersUrl.match(/ashbyhq\.com/)) {
      type = "ashby";
    } else if (careersUrl.match(/lever\.co/)) {
      type = "lever";
    }

    const config: Record<string, unknown> = { title_filter: titleFilter };
    if (careersUrl) config.careers_url = careersUrl;
    if (api) config.api = api;

    return {
      name: c.name as string,
      type,
      config,
      enabled: c.enabled !== false,
    };
  });
}
