import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { exportReceipt } from "../server/domain/service.js";
import { actorFrom, guarded } from "../server/lib/action-kit.js";

export default defineAction({
  description:
    "Export a proof receipt: obligations, approvals, verdicts, evidence digests, verification history, limitations and an HMAC integrity block. Evidence whose digest no longer matches is reported as UNKNOWN.",
  schema: z.object({ contractId: z.string() }),
  run: async (args, ctx) =>
    guarded(() => exportReceipt(getDb(), actorFrom(ctx), args)),
});
