# Development log

Living log so progress survives context resets. Newest entries first.

## 2026-10-29: Day 1 (bootstrap → working P0 loop)

**Done**

- Read the team's private concept research (not included in this repository; disclosed in `docs/SUBMISSION.md`). Key input: lead with end-to-end outcome verification and a short demo that shows a failure the agent missed.
- Public docs sites (agent-native.com, builder.io) are blocked by the session's network policy, so framework docs were read from the version-matched copy shipped inside `@agent-native/core@0.222.0` (`node_modules/@agent-native/core/docs`).
- Scaffolded the official starter: `npx @agent-native/core@0.222.0 create --standalone --template chat` (commit `6511b5f`, kept unmodified except pinning `@agent-native/otel@0.1.26`, because 0.1.27's tarball 404s on npm).
- Domain core (`915bbf3`): schema + 17 migrations, state machine, sandbox billing/memory providers with 8 fault scenarios, read-only observation layer, pure verifier, executor (idempotency, bounded retries, approval re-check), repair planner, receipts, audit hash chain, 13 shared actions.
- UI (`ca16bd5`): "Ledger & Seal" design: Studio home with composer and Replay Lab, contract workspace with the Promised / Claimed / Observed triptych, Execution Theater, Evidence ledger, Memory Lineage graph, Repair Studio, Receipt panel.
- Tests: 53 Vitest (unit + integration on PGlite), 6 Playwright E2E. Typecheck, lint, format and build pass. CI workflow added.

**Decisions**

- Verifier as pure functions over observations, so independence is structural, not a convention.
- Approvals bound to a hash of the terms. Execution re-checks the hash.
- Domain approvals plus the framework's `needsApproval` for workspace reset (shows both mechanisms).
- Removed the starter's Slack `provider-api-request` tool to reduce the tool-misuse surface.
- Lineage graph moved from the narrow inspector to a full-width section (readability).

**Issues found and fixed**

- Fault injection consumed "ignore idempotency" on the first call, so the duplicate never happened. Now it fires only on a real retry.
- The receipt "edited copy" drill was a no-op on already-VERIFIED receipts. It now always makes a real edit.
- The lifecycle rail said "Verified" for FAILED contracts. It is renamed "Independently checked".

**Next (priority order)**

1. Watch the first GitHub Actions run; fix anything environment-specific.
2. Exercise the live agent path with an LLM (needs a key or a Builder.io connection from the owner).
3. Preview deployment: needs a host decision and hosted Postgres (owner approval needed if it costs money or exposes the app publicly).
4. P1 polish: keyboard pass, empty/error states review, demo pacing for the 90-second Clips recording.
