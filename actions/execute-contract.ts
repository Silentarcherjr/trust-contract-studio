import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { executeContract } from "../server/domain/service.js";
import { actorFrom, guarded } from "../server/lib/action-kit.js";

export default defineAction({
  description:
    "Execute every approved obligation against the sandbox providers (idempotent, bounded retries), then run independent verification. Also resumes an interrupted contract. Only obligations a person approved with matching parameters run.",
  schema: z.object({
    contractId: z.string(),
    paceMs: z
      .number()
      .int()
      .min(0)
      .max(2000)
      .optional()
      .describe("Delay between steps so the timeline is watchable."),
  }),
  deferLoading: false,
  run: async (args, ctx) =>
    guarded(() => executeContract(getDb(), actorFrom(ctx), args)),
});
