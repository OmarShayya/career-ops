import { readFile, writeFile } from "fs/promises";
import { join } from "path";
import { eq, sql } from "drizzle-orm";
import yaml from "js-yaml";
import type { Database } from "../../db/client.js";
import { sources, discoveredJobs } from "../../db/schema.js";
import { NotFoundError } from "../../shared/errors.js";
import type { z } from "zod";
import type { createSourceSchema, updateSourceSchema } from "./schema.js";

type CreateSource = z.infer<typeof createSourceSchema>;
type UpdateSource = z.infer<typeof updateSourceSchema>;

export class SourcesService {
  constructor(
    private db: Database,
    private careerOpsRoot: string,
  ) {}

  async list() {
    const rows = await this.db
      .select({
        id: sources.id,
        name: sources.name,
        type: sources.type,
        config: sources.config,
        enabled: sources.enabled,
        lastScannedAt: sources.lastScannedAt,
        createdAt: sources.createdAt,
        updatedAt: sources.updatedAt,
        jobCount: sql<number>`count(${discoveredJobs.id})::int`,
      })
      .from(sources)
      .leftJoin(discoveredJobs, eq(discoveredJobs.sourceId, sources.id))
      .groupBy(sources.id)
      .orderBy(sources.name);

    return rows;
  }

  async create(body: CreateSource) {
    const [created] = await this.db
      .insert(sources)
      .values({
        name: body.name,
        type: body.type,
        config: body.config,
        enabled: body.enabled,
      })
      .returning();

    this.syncToPortalsYml().catch((err) =>
      console.error("Failed to sync to portals.yml:", err),
    );

    return created;
  }

  async update(id: string, body: UpdateSource) {
    const [existing] = await this.db
      .select()
      .from(sources)
      .where(eq(sources.id, id));

    if (!existing) throw new NotFoundError("Source", id);

    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    if (body.name !== undefined) updateData.name = body.name;
    if (body.type !== undefined) updateData.type = body.type;
    if (body.config !== undefined) updateData.config = body.config;
    if (body.enabled !== undefined) updateData.enabled = body.enabled;

    const [updated] = await this.db
      .update(sources)
      .set(updateData)
      .where(eq(sources.id, id))
      .returning();

    this.syncToPortalsYml().catch((err) =>
      console.error("Failed to sync to portals.yml:", err),
    );

    return updated;
  }

  async remove(id: string) {
    const [existing] = await this.db
      .select()
      .from(sources)
      .where(eq(sources.id, id));

    if (!existing) throw new NotFoundError("Source", id);

    await this.db.delete(sources).where(eq(sources.id, id));

    this.syncToPortalsYml().catch((err) =>
      console.error("Failed to sync to portals.yml:", err),
    );
  }

  private async syncToPortalsYml(): Promise<void> {
    const portalsPath = join(this.careerOpsRoot, "portals.yml");

    // Read existing portals.yml to preserve title_filter and other top-level keys
    let existingDoc: Record<string, unknown> = {};
    try {
      const content = await readFile(portalsPath, "utf-8");
      existingDoc = (yaml.load(content) as Record<string, unknown>) ?? {};
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }

    const titleFilter = existingDoc.title_filter ?? {};

    const allSources = await this.db
      .select()
      .from(sources)
      .orderBy(sources.name);

    const tracked_companies = allSources.map((src) => {
      const config = (src.config ?? {}) as Record<string, unknown>;
      const entry: Record<string, unknown> = {
        name: src.name,
        enabled: src.enabled,
      };
      if (config.careers_url) entry.careers_url = config.careers_url;
      if (config.api) entry.api = config.api;
      return entry;
    });

    const doc: Record<string, unknown> = {
      ...existingDoc,
      title_filter: titleFilter,
      tracked_companies,
    };

    await writeFile(portalsPath, yaml.dump(doc), "utf-8");
  }
}
