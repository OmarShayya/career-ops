import { readFile, writeFile } from "fs/promises";
import { join } from "path";
import { eq, desc } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { applications, statusHistory } from "../../db/schema.js";
import { NotFoundError, ValidationError } from "../../shared/errors.js";

export const KANBAN_COLUMNS = [
  "Evaluated",
  "Applied",
  "Responded",
  "Interview",
  "Offer",
] as const;

export const ARCHIVE_STATUSES = ["Rejected", "Discarded", "SKIP"] as const;

type KanbanStatus = (typeof KANBAN_COLUMNS)[number];
type ArchiveStatus = (typeof ARCHIVE_STATUSES)[number];
type AnyStatus = KanbanStatus | ArchiveStatus;

export function validateTransition(from: string, to: string): boolean {
  if (from === to) return false;

  const isToArchive = (ARCHIVE_STATUSES as readonly string[]).includes(to);
  if (isToArchive) return true;

  const fromIdx = (KANBAN_COLUMNS as readonly string[]).indexOf(from);
  const toIdx = (KANBAN_COLUMNS as readonly string[]).indexOf(to);

  if (fromIdx === -1 || toIdx === -1) return false;

  return toIdx > fromIdx;
}

export class PipelineService {
  constructor(
    private db: Database,
    private careerOpsRoot: string,
  ) {}

  async getGrouped() {
    const rows = await this.db
      .select()
      .from(applications)
      .orderBy(desc(applications.number));

    const columnMap = new Map<string, typeof rows>(
      KANBAN_COLUMNS.map((col) => [col, []]),
    );
    const archive: typeof rows = [];

    for (const row of rows) {
      if ((ARCHIVE_STATUSES as readonly string[]).includes(row.status)) {
        archive.push(row);
      } else if (columnMap.has(row.status)) {
        columnMap.get(row.status)!.push(row);
      }
    }

    const columns = KANBAN_COLUMNS.map((status) => ({
      status,
      applications: columnMap.get(status)!,
    }));

    return { columns, archive };
  }

  async moveCard(id: string, toStatus: string) {
    const [existing] = await this.db
      .select()
      .from(applications)
      .where(eq(applications.id, id));

    if (!existing) throw new NotFoundError("Application", id);

    if (!validateTransition(existing.status, toStatus)) {
      throw new ValidationError(
        `Invalid transition from '${existing.status}' to '${toStatus}'`,
      );
    }

    const [updated] = await this.db
      .update(applications)
      .set({ status: toStatus, updatedAt: new Date() })
      .where(eq(applications.id, id))
      .returning();

    await this.db.insert(statusHistory).values({
      applicationId: id,
      fromStatus: existing.status,
      toStatus,
      source: "dashboard",
    });

    this.syncStatusToMarkdown(existing.number, toStatus).catch((err) =>
      console.error("Failed to sync pipeline status to markdown:", err),
    );

    return updated;
  }

  private async syncStatusToMarkdown(
    number: number,
    newStatus: string,
  ): Promise<void> {
    const appsMdPath = join(this.careerOpsRoot, "data", "applications.md");

    let content: string;
    try {
      content = await readFile(appsMdPath, "utf-8");
    } catch {
      return;
    }

    const lines = content.split("\n");
    const updatedLines = lines.map((line) => {
      if (!line.startsWith("|")) return line;
      const cells = line.split("|").map((s) => s.trim());
      if (parseInt(cells[1]) !== number) return line;
      cells[6] = newStatus;
      return "| " + cells.slice(1, cells.length - 1).join(" | ") + " |";
    });

    await writeFile(appsMdPath, updatedLines.join("\n"), "utf-8");
  }
}
