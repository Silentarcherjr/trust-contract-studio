import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { tamperEvidence } from "../server/domain/service.js";
import { actorFrom, guarded } from "../server/lib/action-kit.js";

export default defineAction({
  description:
    "Replay Lab drill: forge the latest stored evidence without updating its digest, to show that integrity checks catch it.",
  schema: z.object({ contractId: z.string() }),
  agentTool: false,
  mcpTool: false,
  toolCallable: false,
  run: async (args, ctx) =>
    guarded(() => tamperEvidence(getDb(), actorFrom(ctx), args)),
});
