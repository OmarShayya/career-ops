import { z } from "zod";

export const createSourceSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["greenhouse", "ashby", "lever", "custom"]),
  config: z.record(z.unknown()).default({}),
  enabled: z.boolean().default(true),
});

export const updateSourceSchema = z.object({
  name: z.string().min(1).optional(),
  type: z.enum(["greenhouse", "ashby", "lever", "custom"]).optional(),
  config: z.record(z.unknown()).optional(),
  enabled: z.boolean().optional(),
});
