# Development log

Living log so progress survives context resets. Newest entries first.

## 2026-11-09: Checked against a real provider (Dodo Payments, test mode)

- **Adapter.** [`server/providers/dodo.ts`](../server/providers/dodo.ts) has two parts:
  - effects: start a subscription with a saved test card, cancel it, create a refund;
  - read-only observations: GET requests that return the sandbox's observation types, so the **unchanged** verifier judges Dodo's state.
  - Only succeeded refunds count as money returned. A refund still `pending` or `review` gives UNKNOWN.
  - The adapter refuses live-mode keys.
- **`pnpm demo:dodo`.** It starts a fresh $100/month test subscription, cancels it, and refunds $50.
  - In the default run, the first refund's response is treated as lost and the call is retried. Dodo documents no idempotency key, so the retry creates a second real refund.
  - Result: cancel VERIFIED; refund **FAILED**, with 2 live refunds totalling $100 (over by $50), while the executor said "Done".
  - The clean run is VERIFIED for both clauses. Evidence is in `docs/eval/dodo-live-run.md`.
- **5 adapter tests** with a stubbed `fetch`: duplicate refund, failed refund, pending refund (UNKNOWN), cancelled and active subscription, live key refused.
- **Limits.**
  - Cancellation and refunds only, test mode, command line; the Studio still runs on the sandbox.
  - Refunds at a real provider cannot be voided, so repairing an over-refund needs a person.

## 2026-11-04: Security review fixes

An independent review read the code against the invariants and confirmed several issues with probes. All the confirmed issues are fixed except the remaining limits listed below.

- **Approval now needs proof of the signed-in UI.**
  - The service treated the framework's `frontend` caller as "a person". That caller comes from a header any client can set, so a script holding a session token could approve.
  - `decide-approval` and the tamper drill now declare `uiOnly`. The framework then requires the same origin, a browser cookie session, no `Authorization` header and a short-lived UI capability.
  - The CLI no longer counts as a person, because coding agents drive it.
  - Probe against a local server: a header-only call gets 403 `ui_capability_required`, and approving in the Studio still works.
- **Edits void approvals.**
  - A new title or new dependencies now reset an approval, not only new parameters. Before, an approved refund could have its `cancel first` dependency removed and keep its approval.
  - The executor also checks the approval state, not only the latest decision's hash.
- **One refund promise per charge per contract.** Refund verification checks the charge's total of live refunds. Two promises on one charge would each see the other's refund and both read as over-refunded.
- **No stuck contracts.**
  - An error during execution now leaves the contract `interrupted` (resumable) instead of `executing`.
  - A run whose function died is treated as interrupted after 5 minutes.
  - A verification that stopped on an error can be retried.
  - Repair proposals are validated before the contract moves to a new round.
- **Smaller hardening:**
  - repair-only refund and memory ids are validated;
  - at most 16 obligations per contract;
  - receipt checks refuse bodies over 256 KB, nesting deeper than 32 levels and reserved keys;
  - the in-app agent no longer has the framework's raw SQL read tools;
  - vector searches are exact and scoped by owner. The approximate HNSW index is dropped, because it filters by owner only after the scan.
- **Citation wording:** the 45–48% false-success figure now names its scope: single-control τ²-bench domains (airline and retail).
- **Checks:**
  - 72 unit/integration tests (5 new);
  - 9/9 local E2E;
  - outcome evaluation unchanged (512 combinations, 0 false VERIFIED, 0 false FAILED, 512/512 converge).
- **Still open (in THREAT_MODEL):**
  - sign-up has no email verification, so per-workspace rate limits can be multiplied;
  - two contracts refunding the same charge affect each other's verdicts.

## 2026-11-04: Showcase includes the disguised copy

**Done**

- **Showcase now has three silent failures in one run:** the retried refund paid twice, the vector-index replica that keeps derived memories, and the re-indexing job that leaves a disguised copy of the email. Only the pgvector similarity search finds the disguised copy.
- **Fault fix:** `memory.reembed_untracked` now fires whenever the purge targets the vector index. It used to check the store list after `skip_vector_index` had filtered it, so the two faults never fired together.
- **Repair planner:** delete proposals of the same kind, for the same clause, are merged, so the repair reads "Delete 3 residual record(s)" instead of two separate proposals.
- **Demo script and autopilot** updated: §4 now shows both `residual_lineage` and `near_duplicate_vector`. The button-mode rehearsal hit all 7 beats in 1:30.0 and ended VERIFIED.
- **Checks:** 67 unit/integration tests, 9/9 local E2E, outcome evaluation unchanged (512 combinations, 0 false VERIFIED, 0 false FAILED).

## 2026-11-02: Vector index on a real pgvector engine

**Done**

- **Real vector engine.** The vector index store now runs on PostgreSQL + pgvector: Neon in production, with the same database, `CREATE EXTENSION vector` and an HNSW cosine index. Locally and in tests it uses a separate PGlite instance with `@electric-sql/pglite-pgvector@0.0.14`, pinned to our PGlite 0.5.13, because the framework's PGlite cannot load extensions.
- **What changes.**
  - Deletes are physical.
  - The observation layer asks the engine which embeddings are live and runs nearest-neighbour searches with the subject's identifiers. It returns only labels, ids and distances.
  - The verifier stays pure, with a new `near_duplicate_vector` reason, and the repair planner maps it to `delete_memories`.
- **New fault and scenario, "Disguised copy".** After the purge, a re-indexing job re-embeds the customer's email in reformatted form with no lineage. Text matching misses it; pgvector finds it at cosine distance 0.16. The threshold is 0.35, because another customer's email on the same domain sits at 0.47.
- **Migration 19** adds `sbx_memories.truth_subject`, ground truth for the evaluation's oracle only.
- **Outcome evaluation:** 512 combinations of 9 faults, 2,048 clauses, 0 false VERIFIED, 0 false FAILED and 512/512 converging. The "Done" claim was false in 43.75 % of clauses, all caught.
- **Verified on the deployment.** The panel shows "pgvector on PostgreSQL", the disguised copy is FAILED at 0.16, and after repair the vector is deleted in Neon and the contract is VERIFIED.
- **Honest limit:** the embeddings are lexical (no model), stated in the README and ARCHITECTURE.

## 2026-11-01: Protected deployment on Vercel (issue #2)

**Done**

- **Vercel project** `trust-contract-studio` (team HACKS), connected to the private repo.
  - Build command: `pnpm migrate:production && NITRO_PRESET=vercel pnpm build`, so migrations run before every build.
  - Node 22, protected source maps.
  - The framework sweep cron is set to daily (`AGENT_NATIVE_VERCEL_CRON_SCHEDULE`), because Hobby only allows daily crons.
- **Database:** Neon Postgres (us-east-2, pooled connection).
- **Secrets:** `DATABASE_URL`, `BETTER_AUTH_SECRET`, `RECEIPT_SIGNING_KEY` and `CRON_SECRET` were added by the owner in the Vercel dashboard as sensitive values. They never passed through the agent session.
- **First deployment:** READY in about 2 min 20 s from commit `b62b1ac`.
- **Access:** Vercel Authentication is on for all deployments. `/studio`, `/mcp` and `/.well-known/mcp.json` all redirect unauthenticated visitors to Vercel SSO (checked with curl).

**Deployment checks (2026-11-02)**

- **E2E against the deployment.** Playwright gained a remote mode: `E2E_BASE_URL`, a fresh synthetic account per run in `e2e/global-setup.ts`, and the Vercel bypass taken from the environment.
  - The first remote run gave 8/9. The first sandbox reset could intermittently drop keyboard focus to `<body>`, which never happens locally.
  - Fix: for a few seconds after a reset, focus returns to the Reset button if it lands on `<body>`.
  - Result: 3/3 keyboard reruns and then **9/9 for the full suite** on the deployment.
- **Sign-up** works without email verification; each account gets its own workspace.
- **The "local dev" sign-in is closed in production.** `GET /_agent-native/auth/local-dev` returns `available: false (not-allowed)` and `POST` returns 404.
- **Agent chat in production.** The framework does not let signed-in users spend the deployment's Builder keys (the deploy credential fallback is off in production). Each user connects their own AI ("Use Builder.io" or custom keys), so visitors cannot drain the owner's credits. The Builder keys in the Vercel env are therefore unused and can be removed.

**Before opening it to judges (near Nov 8–9)**

- Switch protection off in one setting.
- Agent chat in production: each user connects their own AI (framework default). Optionally document that for judges.
- Run the E2E suite against the deployment.
- Do not rotate `RECEIPT_SIGNING_KEY` after recording.

## 2026-11-01: External agents over MCP

**Done**

- **The MCP catalog was empty.** `server/plugins/agent-chat.ts` had `connectorCatalog: []`, so external MCP hosts saw none of our actions. The catalog now lives in `server/lib/mcp-catalog.ts`. It offers draft, read, execute, verify, repair and the receipt actions, and never offers `decide-approval`, `tamper-evidence` or `reset-demo` (a test guards this).
- **New `get-receipt` action** (read-only, owner-scoped). MCP shortens long results from mutating actions, so external agents read state back through read-only actions.
- **`pnpm demo:external-agent`.** A raw MCP client (JSON-RPC over Streamable HTTP, no SDK) plays an outside support agent:
  - it connects and sees our tools, without `decide-approval`;
  - it drafts, then tries `decide-approval` and gets "Unknown tool";
  - it waits for a person to approve in the Studio and executes;
  - its own "Done" claims are contradicted (FAILED: $200 refunded, 2 embeddings left);
  - it proposes repairs, reaches VERIFIED, and checks an intact signed receipt.
- **Execution Theater labels.** Calls from MCP now show as **External agent · MCP**; A2A calls are labelled too. Screenshot: `docs/screenshots/08-external-agent-mcp.png`.
- **Static-token identity.** With a static token, MCP identity comes from the server's `AGENT_NATIVE_OWNER_EMAIL` (local, single-tenant only). Hosted deployments use the framework's MCP OAuth.
- **pgvector investigated.** The framework's PGlite cannot load extensions, so a real vector store needs a separate engine (a PGlite instance with `@electric-sql/pglite-pgvector`, or Neon in production). Not built yet.

## 2026-11-01: Measured evaluation and problem framing

**Done**

- **Outcome evaluation** (`pnpm eval:outcomes`, in CI):
  - Coverage: all 256 combinations of the 8 faults, checked against an independent oracle that reads the sandbox tables directly.
  - Verdicts: 0 false VERIFIED and 0 false FAILED over 1,024 clauses.
  - The executor's "Done" was false 384 times (37.5 %), and the verifier caught every case.
  - It found a real bug: the repair planner could refund the same late charge twice. Fixed (`dedupeProposals`) with a unit test, and 256/256 runs now converge to VERIFIED.
- **Live agent evaluation** (`pnpm eval:agent`):
  - 18 runs, with 72/72 clause verdicts reported exactly and 0 overclaims.
  - 0 agent approvals across 9 adversarial runs.
  - The agent resumed both interrupted runs and re-observed the stale reads on its own.
  - Cost: 3.49 credits.
- **Problem framing.** The README now has a "Who it is for" section (a support-operations persona) with six verified, cited facts: research on agents' false success claims, Gartner and Klarna adoption figures, idempotency, deletion-request growth, and embedding inversion.
- Stripe is not available in Panama. A real-provider adapter would have to use the PayPal Sandbox or a real vector DB instead (pending decision).

## 2026-11-01: Agent-led demo take, submission text, one-pager

**Done**

- Checked the official pages again (rules, homepage, submit form): the deadline is **Nov 9, 11:59 PM PT** on all three; winners on Nov 13. A third-party search result saying Nov 2 was wrong.
- `pnpm demo:autopilot --agent`: an event-driven, agent-led take through the sidebar. The agent drafts, refuses to approve, executes after the human approves, reports FAILED with the verifier's numbers, proposes repairs, and re-executes to VERIFIED. Then the receipt. Rehearsal: 1:55.7, final VERIFIED, 0.70 credits (the prototype took 66 s of agent time and 0.48 credits). The pre-roll folds the app navigation so the canvas stays readable next to the sidebar.
- Agent system prompt: execute with `paceMs 1500` so the Execution Theater can be followed.
- `docs/DEMO_SCRIPT.md`: agent-led take is now the recommended one, with narration that announces the failure in the first sentence. The 90 s button-only take is kept as a fallback.
- `docs/SUBMISSION.md`: a paste-ready description field (~270 words) that includes team members (placeholder) and pre-existing work, because the form has no separate field for them.
- `docs/one-pager/`: a one-page summary in the app's visual language, for the optional slides field. It is not published yet.

## 2026-11-01: Submission description and disclosure review

**Done**

- `docs/SUBMISSION.md` now has a draft project description for the form (name, tagline, short and full description, built-with, links). Every number in it comes from the test report or the live agent run. It contains none of the forbidden claims (compliance, universal erasure, exactly-once, immutability).
- The pre-existing materials disclosure has had its final review:
  - starter files modified or removed during the event, checked with `git diff 6511b5f`;
  - a third-party library table with licenses, saying whether the starter or the event added each library (checked against the starter's `package.json`);
  - a row for AI coding assistance.
- Corrected the action count: 14 domain actions are new. The starter's `navigate`, `view-screen` and `run` are unmodified.

**Waiting on the owner:** review the description and sign off on the disclosure (especially the AI-assistance row), record the Clips video, add its link and submit.

## 2026-11-01: Demo pacing for Clips (issue #3)

**Done**

- Demo mode: `?demo=1` (`app/lib/demo-mode.ts`) paces execution at 1800 ms per step instead of 650 ms. The setting is kept for the browser tab, and `?pace=` overrides it for tuning. The Studio home reads it too, so the flag survives navigating to a contract.
- Measured the Showcase run at 650/1200/1500/1800/2000 ms. At 1800 ms the first execution reaches FAILED in 8.9 s and the repair in 4.4 s, so both fit their 15-second storyboard slots with time to narrate. Normal mode is still 3.9 s.
- Executor: the pause before a retry is now half the step pace, capped at 1 s (was the pace capped at 0.4 s), so the refund timeout → retry is visible in demo mode. Normal runs: 325 ms instead of 400 ms.
- `pnpm demo:autopilot` (`scripts/demo-autopilot.ts`) plays the 90-second storyboard on a fixed clock, ringing the element being narrated, with optional `--video`. It exits 1 if a beat overruns. Rehearsal: 7/7 beats inside their slots, 1:30.0, final seal VERIFIED. The video frames were checked against the storyboard.
- `docs/DEMO_SCRIPT.md` has the measurements and how to use the autopilot. The agent variant now has real timings from the live run.
- Results: 62/62 Vitest (+6 demo-mode tests), 8/8 Playwright, typecheck, lint, format and build green.

**Keyboard-only walkthrough (automated):** `e2e/keyboard.spec.ts` drives the full loop without a mouse and checks the focus ring at every stop. It found and fixed three problems:

- The inspector tabs did not move focus with the arrow keys.
- Focus fell to `<body>` whenever a step's button was replaced: it took 35 Tab presses to reach Execute. Focus now moves to the next step's button, so the loop is Enter-only.
- Export receipt and Reset sandbox dropped focus while pending; they now use `aria-disabled`.

Results: 9/9 Playwright, 62/62 Vitest, autopilot still 7/7 on time.

**Still open on #3:** a manual screen-reader pass with real assistive technology (needs a person).

## 2026-10-31: Live agent path (issue #1)

**Done** (follows the "first steps" in the entry below and answers its open questions: yes, the keys unlock LLM calls on the free plan, and a chat turn costs 0.06–0.20 credits)

- Confirmed `BUILDER_PUBLIC_KEY` and `BUILDER_PRIVATE_KEY` are set in the environment (presence only, values not printed). The framework picks them up as the Builder.io gateway connection. The gateway (`api.builder.io`) is reachable from the container. Plan: free, 15 credits/day.
- Drove the real in-app agent through `/chat` (dev server with `DEV_HOST=127.0.0.1`, Showcase scenario): it drafted with `draft-contract`, navigated to the canvas, refused to approve when asked, executed only after canvas approval, reported verdicts that match the verifier exactly (4/4, then 6/6 after repair), proposed the repair on its own, and its `reset-demo` call paused for framework approval. The prompt-injection probe in the goal had no effect.
- Measured cost: **0.51 Builder credits** for 5 turns (≈0.45 for a full draft → repair → re-verify loop). Transcript: `docs/LIVE_AGENT_RUN.md`. Screenshot: `docs/screenshots/07-live-agent-chat.png`.

**Observations**

- The default model on the gateway was GPT-6 Luna. Results with other models are untested.
- The agent's run can discover ~199 tools through `tool-search` (framework tools included). `decide-approval` did not show up in any run's event stream, including its `tool-search` results.
- To read a thread's tool calls after the fact: `GET /_agent-native/agent-chat/runs/latest?threadId=…`, then `/runs/<runId>/events`.

**Next**

1. Preview deployment (#2): still needs the owner's approval.
2. Clips recording: the live chat turns above can replace the scripted "Ask the agent" segment.

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

- ~~LLM access for issue #1~~: resolved, Builder.io keys provided (see entry above).
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
