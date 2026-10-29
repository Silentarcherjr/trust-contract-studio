import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { resetDemo } from "../server/domain/service.js";
import { actorFrom, guarded } from "../server/lib/action-kit.js";
import { SCENARIOS } from "../shared/domain.js";

export default defineAction({
  description:
    "Wipe this workspace and reseed the synthetic sandbox (customer Ada Quinn) with one adversarial scenario active. Destroys all contracts, evidence and receipts in the workspace.",
  schema: z.object({
    scenario: z
      .enum(SCENARIOS)
      .default("clean")
      .describe(`Fault scenario to activate: ${SCENARIOS.join(", ")}.`),
  }),
  // Destructive for the whole workspace: the agent must get a person's OK.
  needsApproval: true,
  run: async ({ scenario }, ctx) =>
    guarded(() => resetDemo(getDb(), actorFrom(ctx), { scenario })),
});
