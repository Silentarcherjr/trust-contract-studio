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
  // Never offered to any agent. The service also refuses non-human callers,
  // so a direct HTTP/MCP/A2A call cannot self-approve either.
  agentTool: false,
  mcpTool: false,
  toolCallable: false,
  run: async (args, ctx) =>
    guarded(() => decideApproval(getDb(), actorFrom(ctx), args)),
});
