import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { lateRefundDrill } from "../server/domain/service.js";
import { actorFrom, guarded } from "../server/lib/action-kit.js";

export default defineAction({
  description:
    "Replay Lab drill: after a refund was VERIFIED, make a $10 refund on the same charge outside the Studio (a real refund at Dodo in real billing), so the next fresh observation breaks the kept promise.",
  schema: z.object({ contractId: z.string() }),
  uiOnly: true,
  agentTool: false,
  mcpTool: false,
  toolCallable: false,
  run: async (args, ctx) =>
    guarded(() => lateRefundDrill(getDb(), actorFrom(ctx), args)),
});
