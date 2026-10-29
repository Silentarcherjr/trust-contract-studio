import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { getContractView } from "../server/domain/service.js";
import { actorFrom, guarded } from "../server/lib/action-kit.js";

export default defineAction({
  description:
    "Read one trust contract in full: obligations with approval/execution/verdict, execution attempts (including the executor's own claims), verifier reasons, evidence with integrity status, and the audit trail.",
  schema: z.object({ contractId: z.string().describe("Contract id, e.g. ctr_…") }),
  http: { method: "GET" },
  deferLoading: false,
  run: async ({ contractId }, ctx) => guarded(() => getContractView(getDb(), actorFrom(ctx).email, contractId)),
});
