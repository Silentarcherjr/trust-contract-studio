/**
 * Sandbox memory provider — mutating API used only by the executor.
 *
 * Deletions are soft (deleted_at) so the Memory Lineage view can show what
 * was removed. The analytics export is a third-party copy: the provider can
 * forward a deletion request but has no way to apply or confirm it.
 */
import { and, eq, inArray, isNull } from "drizzle-orm";

import type { StoreName } from "../../shared/domain.js";
import type { Db } from "../db/index.js";
import { sbxMemories } from "../db/schema.js";
import { ContractError } from "../domain/errors.js";
import { nowIso } from "../domain/integrity.js";
import { takeFault } from "./faults.js";

export async function erasePersonalData(
  db: Db,
  owner: string,
  input: { customerId: string; stores: StoreName[] },
) {
  const deletedAt = nowIso();
  const local = input.stores.filter((s) => s !== "analytics_export");
  const erased = local.length
    ? await db
        .update(sbxMemories)
        .set({ deletedAt })
        .where(
          and(
            eq(sbxMemories.ownerEmail, owner),
            eq(sbxMemories.customerId, input.customerId),
            eq(sbxMemories.kind, "pii"),
            inArray(sbxMemories.store, local),
            isNull(sbxMemories.deletedAt),
          ),
        )
        .returning({ id: sbxMemories.id })
    : [];
  return {
    erased: erased.map((r) => r.id),
    forwarded: input.stores.includes("analytics_export") ? ["analytics_export"] : [],
  };
}

/** Lineage closure: every record reachable from the roots via derived_from. */
export function lineageClosure(
  records: { id: string; derivedFrom: string[] }[],
  roots: string[],
): Set<string> {
  const closure = new Set(roots);
  let grew = true;
  while (grew) {
    grew = false;
    for (const r of records) {
      if (!closure.has(r.id) && r.derivedFrom.some((p) => closure.has(p))) {
        closure.add(r.id);
        grew = true;
      }
    }
  }
  return closure;
}

export async function purgeDerivedMemories(
  db: Db,
  owner: string,
  input: { customerId: string; stores: StoreName[] },
) {
  const all = await db
    .select()
    .from(sbxMemories)
    .where(and(eq(sbxMemories.ownerEmail, owner), eq(sbxMemories.customerId, input.customerId)));
  const roots = all.filter((r) => r.kind === "pii").map((r) => r.id);
  const closure = lineageClosure(all, roots);

  let stores: StoreName[] = input.stores.filter((s) => s !== "analytics_export");
  // Fault: a lagging vector-index replica silently ignores the purge.
  if (stores.includes("vector_index") && (await takeFault(db, owner, "memory.skip_vector_index"))) {
    stores = stores.filter((s) => s !== "vector_index");
  }
  const targets = all
    .filter((r) => r.kind !== "pii" && closure.has(r.id) && !r.deletedAt && stores.includes(r.store as StoreName))
    .map((r) => r.id);
  if (targets.length) {
    await db
      .update(sbxMemories)
      .set({ deletedAt: nowIso() })
      .where(and(eq(sbxMemories.ownerEmail, owner), inArray(sbxMemories.id, targets)));
  }
  // The provider reports what it was asked to do, not what it achieved.
  return {
    status: "purged",
    requestedStores: input.stores,
    forwarded: input.stores.includes("analytics_export") ? ["analytics_export"] : [],
  };
}

export async function deleteMemories(
  db: Db,
  owner: string,
  input: { customerId: string; memoryIds: string[] },
) {
  const rows = await db
    .select()
    .from(sbxMemories)
    .where(
      and(
        eq(sbxMemories.ownerEmail, owner),
        eq(sbxMemories.customerId, input.customerId),
        inArray(sbxMemories.id, input.memoryIds),
      ),
    );
  if (rows.length !== input.memoryIds.length) {
    throw new ContractError("Some memories were not found", "provider_not_found", 404);
  }
  if (rows.some((r) => r.store === "analytics_export")) {
    throw new ContractError(
      "The analytics export is a third-party copy and cannot be deleted from here.",
      "provider_unsupported",
      422,
    );
  }
  await db
    .update(sbxMemories)
    .set({ deletedAt: nowIso() })
    .where(and(eq(sbxMemories.ownerEmail, owner), inArray(sbxMemories.id, input.memoryIds)));
  return { deleted: input.memoryIds };
}
