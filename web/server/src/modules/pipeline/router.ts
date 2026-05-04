import type { FastifyInstance } from "fastify";
import { resolve } from "path";
import { PipelineService } from "./service.js";
import { ValidationError } from "../../shared/errors.js";

export async function pipelineRouter(app: FastifyInstance) {
  const getService = () =>
    new PipelineService(app.db, resolve(app.env.CAREER_OPS_ROOT));

  // GET /api/pipeline
  app.get("/api/pipeline", async (_request, reply) => {
    const service = getService();
    const result = await service.getGrouped();
    return reply.send(result);
  });

  // PATCH /api/pipeline/:id/move
  app.patch<{ Params: { id: string }; Body: { toStatus: string } }>(
    "/api/pipeline/:id/move",
    async (request, reply) => {
      const { toStatus } = request.body ?? {};
      if (!toStatus || typeof toStatus !== "string") {
        throw new ValidationError("toStatus is required");
      }
      const service = getService();
      const result = await service.moveCard(request.params.id, toStatus);
      return reply.send(result);
    },
  );
}
