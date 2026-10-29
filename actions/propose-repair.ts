import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { proposeRepair } from "../server/domain/service.js";
import { actorFrom, guarded } from "../server/lib/action-kit.js";

export default defineAction({
  description:
    "For a FAILED or UNKNOWN contract, derive repair obligations from the verifier's reasons (void duplicate refunds, delete residual memories, retry, refund a late charge). Repairs wait for a person's approval. Timeouts and stale reads return re-verify suggestions instead.",
  schema: z.object({ contractId: z.string() }),
  run: async (args, ctx) => guarded(() => proposeRepair(getDb(), actorFrom(ctx), args)),
});
