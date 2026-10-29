# Test report

Last run: **2026-10-29** (UTC), commit on branch `ccr-7e192655-qektlx`, Linux container, Node 22.22.0, pnpm 10.29.1.

| Check              | Command                                                                   | Result                                                                 |
| ------------------ | ------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Typecheck          | `pnpm typecheck`                                                          | ✅ 0 errors                                                            |
| Lint               | `pnpm lint` (oxlint 1.90.0)                                               | ✅ 0 errors (1 warning in an unmodified starter file)                  |
| Format             | `pnpm format:check` (oxfmt)                                               | ✅                                                                     |
| Unit + integration | `pnpm test` (Vitest 4, in-memory PGlite PostgreSQL)                       | ✅ **53 / 53 passed**                                                  |
| End-to-end         | `pnpm test:e2e` (Playwright 1.63, Chromium, real dev server, isolated DB) | ✅ **6 / 6 passed**                                                    |
| Production build   | `pnpm build`                                                              | ✅ Nitro node preset                                                   |
| GitHub Actions     | `.github/workflows/ci.yml`                                                | ✅ run 40826383944 (commit `cab02d4`): checks job + E2E job both green |

## Coverage of required scenarios

| Required                                         | Where tested                                                                                                                                                              | Kind              |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| Successful completion of all obligations         | `scenarios.test.ts` › clean run; E2E forgery drill (clean path first)                                                                                                     | integration, E2E  |
| Duplicate refund attempt                         | `scenarios.test.ts` › duplicate refund (detect → repair → verify); E2E duplicate refund                                                                                   | integration, E2E  |
| Incomplete memory deletion                       | `scenarios.test.ts` › incomplete deletion; `unit.test.ts` › purge residue / untracked copy                                                                                | integration, unit |
| Provider timeout → UNKNOWN                       | `scenarios.test.ts` › provider timeout; E2E provider timeout                                                                                                              | integration, E2E  |
| Contradictory or tampered evidence               | `scenarios.test.ts` › contradictory renewal charge, silent failure, tampered evidence; `actions.test.ts` › receipt edits, audit chain; E2E forgery drill and receipt edit | integration, E2E  |
| Human rejection of a proposed action             | `actions.test.ts` › rejected obligation never executes; E2E rejection                                                                                                     | integration, E2E  |
| Unauthorized action attempts                     | `actions.test.ts` › agent cannot self-approve (5 callers), stale approval, unauthenticated, cross-workspace read/execute, foreign customer ids                            | integration       |
| Replay and reset from a clean state              | `actions.test.ts` › reset is reproducible (same verdict shape twice, audit chain intact); `scenarios.test.ts` › expected-outcomes table for all 8 scenarios               | integration       |
| UI and agent invoke the same Agent-Native action | `actions.test.ts` › “one action, two callers” runs the same `defineAction` objects with `caller: "frontend"` and `caller: "tool"`                                         | integration       |

## What has **not** been tested yet

- **A live LLM agent driving the Studio through chat.** No LLM key is configured in the development container. The agent path is tested at the action layer (`caller: "tool"`), which is the same code the agent loop dispatches, but not through a real model conversation. Planned once a key or Builder.io connection is available.
- The framework's `needsApproval` pause for `reset-demo` when invoked by the agent (needs the same).
- Hosted PostgreSQL. All runs used PGlite, the same SQL dialect.
- Screen-reader pass. Keyboard and ARIA roles were implemented but not audited with assistive technology.
