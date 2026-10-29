/**
 * Glue between framework actions and the contract service: resolves the
 * caller's identity from the framework run context and converts domain
 * errors into framework failures that both the UI and the agent can read.
 */
import { fail, type ActionRunContext } from "@agent-native/core/action";

import { ContractError } from "../domain/errors.js";
import type { Actor } from "../domain/service.js";

export function actorFrom(ctx: ActionRunContext | undefined): Actor {
  const email = ctx?.userEmail;
  if (!email) {
    fail("Sign in to use Trust Contract Studio.", { errorCode: "unauthenticated", statusCode: 401 });
  }
  return { email, caller: ctx?.caller ?? "unknown" };
}

export async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ContractError) {
      fail(err.message, {
        errorCode: err.code,
        statusCode: err.status,
        ...(err.details ? { details: err.details } : {}),
      });
    }
    throw err;
  }
}
