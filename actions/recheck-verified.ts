import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { recheckVerified } from "../server/domain/service.js";
import { actorFrom, guarded } from "../server/lib/action-kit.js";

export default defineAction({
  description:
    "Watch kept promises: re-verify every VERIFIED contract in this workspace on fresh read-only observations. Returns which contracts broke and which clauses changed. Each changed clause also emits the tcs.verdict.changed event, so an automation can notify the person. Meant for a scheduled automation (for example hourly).",
  schema: z.object({}),
  run: async (_args, ctx) =>
    guarded(() => recheckVerified(getDb(), actorFrom(ctx))),
});
