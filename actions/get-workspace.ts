import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { getWorkspace } from "../server/domain/service.js";
import { actorFrom, guarded } from "../server/lib/action-kit.js";

export default defineAction({
  description:
    "Read the sandbox workspace: active fault scenario, the requesting customer, subscription, charges, refunds, and the memory-lineage registry (labels only, no personal data).",
  schema: z.object({}),
  http: { method: "GET" },
  deferLoading: false,
  run: async (_args, ctx) => guarded(() => getWorkspace(getDb(), actorFrom(ctx).email)),
});
