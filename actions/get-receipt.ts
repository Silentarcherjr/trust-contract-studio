import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { getLatestReceipt } from "../server/domain/service.js";
import { actorFrom, guarded } from "../server/lib/action-kit.js";

export default defineAction({
  description:
    "Read the latest proof receipt issued for a contract (obligations, approvals, verdict history, evidence digests, limitations and the integrity block). Read-only: issue a new one with export-receipt.",
  schema: z.object({
    contractId: z.string().describe("Contract id, e.g. ctr_…"),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ contractId }, ctx) =>
    guarded(() => getLatestReceipt(getDb(), actorFrom(ctx).email, contractId)),
});
