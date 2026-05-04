import type { FastifyInstance } from "fastify";
import { resolve } from "path";
import { ApplicationsService } from "./service.js";
import { listQuerySchema, patchBodySchema } from "./schema.js";
import { ValidationError } from "../../shared/errors.js";

export async function applicationsRouter(app: FastifyInstance) {
  const getService = () =>
    new ApplicationsService(app.db, resolve(app.env.CAREER_OPS_ROOT));

  // GET /api/applications
  app.get("/api/applications", async (request, reply) => {
    const parsed = listQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.message);
    }
    const service = getService();
    const result = await service.list(parsed.data);
    return reply.send(result);
  });

  // GET /api/applications/stats — MUST be registered before :id
  app.get("/api/applications/stats", async (_request, reply) => {
    const service = getService();
    const stats = await service.getStats();
    return reply.send(stats);
  });

  // GET /api/applications/:id
  app.get<{ Params: { id: string } }>(
    "/api/applications/:id",
    async (request, reply) => {
      const service = getService();
      const result = await service.getById(request.params.id);
      return reply.send(result);
    },
  );

  // PATCH /api/applications/:id
  app.patch<{ Params: { id: string } }>(
    "/api/applications/:id",
    async (request, reply) => {
      const parsed = patchBodySchema.safeParse(request.body);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.message);
      }
      const service = getService();
      const result = await service.update(request.params.id, parsed.data);
      return reply.send(result);
    },
  );
}
