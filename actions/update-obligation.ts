import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { updateObligation } from "../server/domain/service.js";
import { actorFrom, guarded } from "../server/lib/action-kit.js";

export default defineAction({
  description:
    "Edit one obligation on the Promise Canvas: title, parameters (patch), dependencies, or remove it. Changing parameters voids any earlier approval. Pass expectedVersion (the contract version you read) to avoid overwriting someone else's edit.",
  schema: z.object({
    contractId: z.string(),
    obligationId: z.string(),
    expectedVersion: z.number().int().positive().optional(),
    title: z.string().max(140).optional(),
    params: z.record(z.string(), z.unknown()).optional().describe("Partial params, merged and re-validated."),
    dependsOn: z.array(z.string()).max(8).optional().describe("Obligation ids that must succeed first."),
    remove: z.boolean().optional(),
  }),
  run: async (args, ctx) => guarded(() => updateObligation(getDb(), actorFrom(ctx), args)),
});
