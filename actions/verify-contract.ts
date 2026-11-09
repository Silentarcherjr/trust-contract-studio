import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { verifyContract } from "../server/domain/service.js";
import { actorFrom, guarded } from "../server/lib/action-kit.js";
import { verifiedDoneChatUI } from "../server/lib/verified-done.js";

export default defineAction({
  description:
    "Re-run the deterministic verifier: take fresh read-only observations from billing and memory providers and recompute VERIFIED / FAILED / UNKNOWN for every pursued obligation. Agent claims are never used as evidence.",
  schema: z.object({ contractId: z.string() }),
  // Chat shows a "Verified Done" seal: claims beside verifier verdicts.
  chatUI: verifiedDoneChatUI,
  run: async (args, ctx) =>
    guarded(() => verifyContract(getDb(), actorFrom(ctx), args)),
});
