import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { decideApproval } from "../server/domain/service.js";
import { actorFrom, guarded } from "../server/lib/action-kit.js";

export default defineAction({
  description:
    "A person approves or rejects one sensitive obligation. The decision is bound to the parameter hash they reviewed.",
  schema: z.object({
    contractId: z.string(),
    obligationId: z.string(),
    decision: z.enum(["approved", "rejected"]),
    paramsHash: z
      .string()
      .length(64)
      .describe("Hash of the parameters the person reviewed."),
    note: z.string().max(500).optional(),
  }),
  // Never offered to any agent. `uiOnly` makes the framework demand proof
  // that the request comes from the signed-in app UI (same origin, browser
  // cookie session, short-lived UI capability), so a script that only sets
  // the frontend header is refused with 403. The service also refuses every
  // caller other than "frontend".
  uiOnly: true,
  agentTool: false,
  mcpTool: false,
  toolCallable: false,
  run: async (args, ctx) =>
    guarded(() => decideApproval(getDb(), actorFrom(ctx), args)),
});
