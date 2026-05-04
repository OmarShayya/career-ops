import type { FastifyInstance } from "fastify";
import { resolve } from "path";
import { SourcesService } from "./service.js";
import { createSourceSchema, updateSourceSchema } from "./schema.js";
import { ValidationError } from "../../shared/errors.js";

export async function sourcesRouter(app: FastifyInstance) {
  const getService = () =>
    new SourcesService(app.db, resolve(app.env.CAREER_OPS_ROOT));

  // GET /api/sources
  app.get("/api/sources", async (_request, reply) => {
    const service = getService();
    const result = await service.list();
    return reply.send(result);
  });

  // POST /api/sources
  app.post("/api/sources", async (request, reply) => {
    const parsed = createSourceSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.message);
    }
    const service = getService();
    const result = await service.create(parsed.data);
    return reply.status(201).send(result);
  });

  // PATCH /api/sources/:id
  app.patch<{ Params: { id: string } }>(
    "/api/sources/:id",
    async (request, reply) => {
      const parsed = updateSourceSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.message);
      }
      const service = getService();
      const result = await service.update(request.params.id, parsed.data);
      return reply.send(result);
    },
  );

  // DELETE /api/sources/:id
  app.delete<{ Params: { id: string } }>(
    "/api/sources/:id",
    async (request, reply) => {
      const service = getService();
      await service.remove(request.params.id);
      return reply.status(204).send();
    },
  );
}
