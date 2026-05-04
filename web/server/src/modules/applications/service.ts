import { readFile, writeFile } from "fs/promises";
import { join } from "path";
import { eq, and, gte, lte, ilike, or, sql, desc } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { applications, statusHistory } from "../../db/schema.js";
import { NotFoundError } from "../../shared/errors.js";
import { parseApplicationsMd, serializeApplicationsMd } from "../sync/parsers.js";
import type { z } from "zod";
import type { listQuerySchema, patchBodySchema } from "./schema.js";

type ListQuery = z.infer<typeof listQuerySchema>;
type PatchBody = z.infer<typeof patchBodySchema>;

export class ApplicationsService {
  constructor(
    private db: Database,
    private careerOpsRoot: string,
  ) {}

  async list(query: ListQuery) {
    const { status, minScore, maxScore, search, page, limit } = query;
    const offset = (page - 1) * limit;

    const conditions = [];

    if (status) {
      conditions.push(eq(applications.status, status));
    }
    if (minScore !== undefined) {
      conditions.push(gte(applications.score, String(minScore)));
    }
    if (maxScore !== undefined) {
      conditions.push(lte(applications.score, String(maxScore)));
    }
    if (search) {
      conditions.push(
        or(
          ilike(applications.company, `%${search}%`),
          ilike(applications.role, `%${search}%`),
        ),
      );
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [rows, countResult] = await Promise.all([
      this.db
        .select()
        .from(applications)
        .where(where)
        .orderBy(desc(applications.number))
        .limit(limit)
        .offset(offset),
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(applications)
        .where(where),
    ]);

    return {
      data: rows,
      total: countResult[0]?.count ?? 0,
      page,
      limit,
    };
  }

  async getById(id: string) {
    const [app] = await this.db
      .select()
      .from(applications)
      .where(eq(applications.id, id));

    if (!app) throw new NotFoundError("Application", id);

    const history = await this.db
      .select()
      .from(statusHistory)
      .where(eq(statusHistory.applicationId, id))
      .orderBy(desc(statusHistory.changedAt));

    return { ...app, statusHistory: history };
  }

  async update(id: string, body: PatchBody) {
    const [existing] = await this.db
      .select()
      .from(applications)
      .where(eq(applications.id, id));

    if (!existing) throw new NotFoundError("Application", id);

    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    if (body.status !== undefined) updateData.status = body.status;
    if (body.notes !== undefined) updateData.notes = body.notes;

    const [updated] = await this.db
      .update(applications)
      .set(updateData)
      .where(eq(applications.id, id))
      .returning();

    if (body.status !== undefined && body.status !== existing.status) {
      await this.db.insert(statusHistory).values({
        applicationId: id,
        fromStatus: existing.status,
        toStatus: body.status,
        source: "dashboard",
      });
    }

    this.syncToMarkdown().catch((err) =>
      console.error("Failed to sync to markdown:", err),
    );

    return updated;
  }

  async getStats() {
    const rows = await this.db.select().from(applications);

    const byStatus: Record<string, number> = {};
    let scoreSum = 0;
    let scoreCount = 0;

    for (const row of rows) {
      byStatus[row.status] = (byStatus[row.status] ?? 0) + 1;
      if (row.score !== null && row.score !== undefined) {
        scoreSum += parseFloat(String(row.score));
        scoreCount++;
      }
    }

    return {
      byStatus,
      avgScore: scoreCount > 0 ? Math.round((scoreSum / scoreCount) * 10) / 10 : null,
      totalCount: rows.length,
    };
  }

  private async syncToMarkdown(): Promise<void> {
    const appsMdPath = join(this.careerOpsRoot, "data", "applications.md");

    let content: string;
    try {
      content = await readFile(appsMdPath, "utf-8");
    } catch {
      return;
    }

    const rows = await this.db
      .select()
      .from(applications)
      .orderBy(applications.number);

    const parsed = rows.map((row) => ({
      number: row.number,
      date: row.appliedAt
        ? row.appliedAt.toISOString().slice(0, 10)
        : row.createdAt.toISOString().slice(0, 10),
      company: row.company,
      role: row.role,
      score: row.score ?? null,
      status: row.status,
      pdfGenerated: row.pdfGenerated,
      reportPath: row.reportPath ?? null,
      notes: row.notes ?? "",
    }));

    // Preserve any existing lines above or below the table
    const lines = content.split("\n");
    const tableStart = lines.findIndex((l) => l.startsWith("| #"));
    if (tableStart === -1) {
      // No table found, write full serialized content
      await writeFile(appsMdPath, serializeApplicationsMd(parsed), "utf-8");
      return;
    }

    // Update row by row in the existing content
    const updatedLines = [...lines];
    for (const app of parsed) {
      const lineIdx = updatedLines.findIndex((l) => {
        const cells = l.split("|").map((s) => s.trim());
        return parseInt(cells[1]) === app.number;
      });
      if (lineIdx !== -1) {
        const cells = updatedLines[lineIdx].split("|").map((s) => s.trim());
        cells[6] = app.status;
        cells[9] = app.notes;
        updatedLines[lineIdx] = "| " + cells.slice(1, cells.length - 1).join(" | ") + " |";
      }
    }

    await writeFile(appsMdPath, updatedLines.join("\n"), "utf-8");
  }
}
