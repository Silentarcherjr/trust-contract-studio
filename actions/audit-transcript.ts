import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { auditTranscript } from "../server/domain/service.js";
import { actorFrom, guarded } from "../server/lib/action-kit.js";
import { verifiedDoneChatUI } from "../server/lib/verified-done.js";

export default defineAction({
  description:
    "Audit what another agent says it already did. Paste its transcript; its completion claims (cancelled, refunded $X, data deleted, memories purged) become clauses, and the deterministic verifier checks each one at the registered providers. Nothing is executed or approved. The claims are shown next to the verdicts, never used as evidence.",
  schema: z.object({
    transcript: z
      .string()
      .trim()
      .min(10)
      .max(8000)
      .describe("The other agent's conversation or final message, verbatim."),
  }),
  chatUI: verifiedDoneChatUI,
  run: async (args, ctx) =>
    guarded(() => auditTranscript(getDb(), actorFrom(ctx), args)),
});
