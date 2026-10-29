import { runMigrations } from "@agent-native/core/db";

import { TCS_MIGRATIONS } from "../db/migrations.js";

export default runMigrations(TCS_MIGRATIONS, {
  table: "trust_contract_studio_migrations",
});
