import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { checkReceipt } from "../server/domain/service.js";
import { actorFrom } from "../server/lib/action-kit.js";

export default defineAction({
  description:
    "Check whether a proof receipt JSON is intact and was issued by this server.",
  schema: z.object({ receipt: z.record(z.string(), z.unknown()) }),
  readOnly: true,
  run: async ({ receipt }, ctx) => {
    actorFrom(ctx);
    return checkReceipt(receipt);
  },
});
