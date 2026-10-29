import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { addObligation } from "../server/domain/service.js";
import { actorFrom, guarded } from "../server/lib/action-kit.js";
import { obligationDraftSchema } from "../shared/domain.js";

export default defineAction({
  description:
    "Add an obligation of a verifiable kind to a contract that has not started executing.",
  schema: z.object({
    contractId: z.string(),
    expectedVersion: z.number().int().positive().optional(),
    draft: obligationDraftSchema,
  }),
  run: async (args, ctx) =>
    guarded(() => addObligation(getDb(), actorFrom(ctx), args)),
});
