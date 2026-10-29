import { createGetDb } from "@agent-native/core/db";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import * as schema from "./schema.js";

export { schema };
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

const frameworkGetDb = createGetDb(schema);
let testDb: Db | null = null;

/** Typed Drizzle client shared by every action (UI and agent alike). */
export function getDb(): Db {
  return testDb ?? frameworkGetDb();
}

/** Test seam: route getDb() to an in-memory PGlite instance. */
export function setDbForTesting(db: Db | null): void {
  testDb = db;
}
