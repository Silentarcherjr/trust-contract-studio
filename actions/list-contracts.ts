import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { listContracts } from "../server/domain/service.js";
import { actorFrom, guarded } from "../server/lib/action-kit.js";

export default defineAction({
  description: "List this workspace's trust contracts, newest first.",
  schema: z.object({}),
  http: { method: "GET" },
  run: async (_args, ctx) =>
    guarded(() => listContracts(getDb(), actorFrom(ctx).email)),
});
