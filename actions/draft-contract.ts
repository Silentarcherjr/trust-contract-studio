import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { draftContract } from "../server/domain/service.js";
import { actorFrom, guarded } from "../server/lib/action-kit.js";
import { obligationDraftSchema } from "../shared/domain.js";

export default defineAction({
  description:
    "Turn a person's request into a trust contract of explicit, testable obligations. Pass `obligations` to author them yourself (kinds: cancel_subscription, refund_charge, erase_personal_data, purge_derived_memories; omitted ids default to the requesting customer), or omit it to use the deterministic template planner. Nothing executes until a person approves.",
  schema: z.object({
    goal: z
      .string()
      .trim()
      .min(3)
      .max(500)
      .describe("The request in the person's own words."),
    obligations: z.array(obligationDraftSchema).max(8).optional(),
  }),
  deferLoading: false,
  run: async (args, ctx) =>
    guarded(() => draftContract(getDb(), actorFrom(ctx), args)),
});
