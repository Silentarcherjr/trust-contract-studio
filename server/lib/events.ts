/**
 * Events the Studio emits on the framework event bus, so automations can
 * react to them ("when a kept promise breaks, tell me").
 */
import { emitAsync, registerEvent } from "@agent-native/core/event-bus";
import { z } from "zod";

export const VERDICT_CHANGED = "tcs.verdict.changed";

const verdict = z.enum(["VERIFIED", "FAILED", "UNKNOWN"]);
const payloadSchema = z.object({
  contractId: z.string(),
  obligationId: z.string(),
  clause: z.string(),
  from: verdict,
  to: verdict,
  reason: z.string(),
  url: z.string(),
});
export type VerdictChanged = z.infer<typeof payloadSchema>;

registerEvent({
  name: VERDICT_CHANGED,
  description:
    "A clause's verdict changed on a fresh observation of the providers, for example a VERIFIED refund became FAILED because another refund appeared at the billing provider after verification.",
  payloadSchema,
  example: {
    contractId: "ctr_123",
    obligationId: "obl_456",
    clause: "Refund $100.00 of “Studio Plus — monthly”",
    from: "VERIFIED",
    to: "FAILED",
    reason: "Promised $100.00 but 2 live refunds total $110.00.",
    url: "/studio/ctr_123",
  },
});

/** Never lets an event failure break a verification. */
export async function emitVerdictChanged(
  owner: string,
  payload: VerdictChanged,
) {
  try {
    // Awaited: on serverless hosts the function may stop right after the action.
    await emitAsync(VERDICT_CHANGED, payload, { owner });
  } catch (err) {
    console.warn("[tcs] could not emit verdict change:", err);
  }
}
