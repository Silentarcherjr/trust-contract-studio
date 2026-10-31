# Development log

Living log so progress survives context resets. Newest entries first.

## 2026-10-31: Rules verified, Builder.io connection setup

**Official rules re-read on 2026-10-31** (builder.io/hackathon, /rules, FAQ; network allowlist now includes `www.builder.io` and `www.agent-native.com`):

- Deadline: Mon Nov 9, 2026, 11:59 PM PT (Nov 10 07:59 UTC). Look for the submission confirmation. Recording a clip is not submitting.
- The demo **must be recorded with Clips** (no other tool), publicly viewable without login. Repo and live app are optional; the app may have normal sign-in.
- Disclose pre-existing work, templates and libraries, and what changed during the event.
- Rubric: Usefulness & Execution 40, Creativity & Design 20, Innovation 20, Cleverness & Use of Agent-Native 20 (FAQ: naming or importing the framework is not enough).
- Prizes $5k/$2.5k/$1.5k/$750/$250, gross. Non-US withholding up to 30% possible.
- **No LLM credits for participants.** The FAQ mentions "approved mentorship and credits" only for winners.
- Optional office hours: Nov 3 and Nov 5, 8:30 AM PT.

**LLM access plan:** the Builder.io free plan gives 60 credits/month (15/day max). Agent-Native's "Use Builder.io" managed connection reads `BUILDER_PUBLIC_KEY` and `BUILDER_PRIVATE_KEY` (Space API keys from Space Settings, not personal access tokens; see `dist/server/credential-provider.js`). The owner created a dedicated private key and added both as **environment variables** of the cloud environment. They load only in a **new** session. Not yet verified that these keys unlock LLM calls on the free plan, nor how many credits a chat turn costs. Fallback: `ANTHROPIC_API_KEY`.

**Next session, first steps:** confirm both variables exist (never print the values) → `DEV_HOST=127.0.0.1 pnpm dev` → exercise the agent via chat (issue #1) → record credit usage → update TEST_REPORT and SUBMISSION.

## 2026-10-31: Day 3 (accessibility, polish, demo)

**Done**

- axe-core WCAG 2.1 AA audit of home, canvas, failed contract and every inspector tab, in light and dark themes. Fixed: UNKNOWN ochre contrast (3.98 → above 4.5:1) and the keyboard-unreachable scrollable tab panel. The audit is now part of the E2E suite.
- Dark mode reviewed. The app shell background now matches the studio paper. The "0 residual" chip is neutral when zero.
- Error state verified: unknown contract id shows "Contract not found" plus a way back.
- Per-workspace rate limiting (`server/domain/rate-limit.ts`, migration 18), immune to demo reset (threat model open item closed).
- New **Showcase (demo)** scenario: duplicate refund + residual embeddings in one run, repaired in one round (matches the planned demo storyboard). Measured ~8.5 s of machine time from draft to receipt.
- Repair round: a single banner instead of two, and auto-scroll to the first proposed repair clause (respects reduced motion).
- `docs/DEMO_SCRIPT.md`: 90-second Clips script.
- Results: 56/56 Vitest, 8/8 Playwright, typecheck, lint, format and build all green.

**Waiting on the owner**

- LLM access (Builder.io connection or provider key) for issue #1.
- Approval for the preview deployment (#2): hosting, cost, public exposure.
- Network allowlist for `www.agent-native.com` and `www.builder.io` to re-check rules before submitting.

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

**Tracking**

- Issues #1 (live LLM agent path), #2 (safe preview deployment), #3 (accessibility, polish, demo pacing).
- Screenshots of the current UI are in `docs/screenshots/`.

**Next (priority order)**

1. Watch the first GitHub Actions run; fix anything environment-specific.
2. Exercise the live agent path with an LLM (needs a key or a Builder.io connection from the owner).
3. Preview deployment: needs a host decision and hosted Postgres (owner approval needed if it costs money or exposes the app publicly).
4. P1 polish: keyboard pass, empty/error states review, demo pacing for the 90-second Clips recording.
