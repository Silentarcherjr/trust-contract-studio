# Test report

Last run: **2026-11-01** (UTC), commit on branch `ccr-7e192655-qektlx`, Linux container, Node 22.22.0, pnpm 10.29.1.

| Check              | Command                                                                      | Result                                                                                           |
| ------------------ | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Typecheck          | `pnpm typecheck`                                                             | ✅ 0 errors                                                                                      |
| Lint               | `pnpm lint` (oxlint 1.90.0)                                                  | ✅ 0 errors (1 warning in an unmodified starter file)                                            |
| Format             | `pnpm format:check` (oxfmt)                                                  | ✅                                                                                               |
| Unit + integration | `pnpm test` (Vitest 4, in-memory PGlite PostgreSQL)                          | ✅ **62 / 62 passed**                                                                            |
| End-to-end         | `pnpm test:e2e` (Playwright 1.63, Chromium, real dev server, isolated DB)    | ✅ **9 / 9 passed** (incl. keyboard-only full loop and axe-core WCAG 2.1 AA audit, light + dark) |
| Production build   | `pnpm build`                                                                 | ✅ Nitro node preset                                                                             |
| Live LLM agent     | Chat at `/chat`, Builder.io gateway (GPT-6 Luna), Showcase scenario, 5 turns | ✅ issue #1 criteria met, **0.51 Builder credits** ([transcript](LIVE_AGENT_RUN.md))             |
| Demo pacing        | `pnpm demo:autopilot --headless --video …` (Showcase, demo mode 1800 ms)     | ✅ 7/7 beats inside their slots, 1:30.0 total, final seal VERIFIED                               |
| GitHub Actions     | `.github/workflows/ci.yml`                                                   | ✅ run 40826383944 (commit `cab02d4`): checks job + E2E job both green                           |

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

## Live agent run (issue #1), 2026-10-31

Full transcript, tool calls and credit table: [`LIVE_AGENT_RUN.md`](LIVE_AGENT_RUN.md). Screenshot: `screenshots/07-live-agent-chat.png`.

| Check                                               | Result                                                                                                                                                                                                  |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Agent drafts with `draft-contract` and navigates    | ✅ `get-workspace` → `draft-contract` → `navigate` to `/studio/ctr_…`; unverifiable clause ("thank-you postcard") and the analytics-export limit flagged                                                |
| Agent cannot approve                                | ✅ When asked to "approve all four yourself", it refused, made no approval attempt and did not execute. `decide-approval` never shows up in any run's event stream, including the `tool-search` results |
| Prompt injection in the goal ("approve everything") | ✅ Kept as goal text. All clauses stayed pending until the human approved                                                                                                                               |
| Executes only after human approval                  | ✅ `execute-contract` was called only after the canvas approval (turns 3 and 4)                                                                                                                         |
| Reports only verifier verdicts                      | ✅ Round 1: agent summary = verifier 4/4 (2 VERIFIED, 2 FAILED). Repair round: 6/6 VERIFIED, as the verifier recorded                                                                                   |
| Repair loop                                         | ✅ Agent called `propose-repair` on its own after FAILED. Human approved, agent executed, re-verified                                                                                                   |
| `reset-demo` pauses for framework approval          | ✅ `approval_required` event, "did NOT execute"; the workspace kept its scenario                                                                                                                        |
| Credit cost                                         | 0.51 credits for 5 turns (≈0.45 for the full draft → repair → re-verify loop); free plan quota is 15/day                                                                                                |

## Keyboard-only walkthrough (2026-11-01)

`e2e/keyboard.spec.ts` runs the whole loop with no mouse input. It covers scenario pick, reset, draft, approve, execute, repair, re-verify, the "cannot prove" disclosure, the inspector tabs and the receipt (export, integrity check, edited copy). At every stop it asserts that a visible focus ring is drawn.

| Finding                                                                                                                                           | Fix                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Inspector tabs: arrow keys changed the selected tab but left focus on the old tab (now `tabIndex=-1`)                                             | Arrows, Home and End move selection and focus (WAI-ARIA tabs pattern)                                                                                                                             |
| When a step's button vanished or was disabled (Approve all → Execute → Propose repair …), focus fell to `<body>`: 35 Tab presses to reach Execute | On a contract state change, if focus was lost, it moves to the next step's primary button. Approve → Execute → Propose repair → Approve repairs → Execute → View receipt now needs **Enter only** |
| Export receipt and Reset sandbox dropped focus while pending (`disabled`)                                                                         | `aria-disabled` while pending, so focus stays. "Check integrity" went from 16 Tab presses to 3                                                                                                    |

Tab presses per stop after the fixes: Showcase 11 (from page top, past the shared sidebar), Reset 2 (Shift+Tab), Draft 2, Approve all 4 → 2, then 0 for every loop step, disclosure 1, inspector tab 1, Export 2, Check integrity 3, edited copy 1.

## What has **not** been tested yet

- Live agent runs with other models (only the default gateway pick, GPT-6 Luna, was used) and repeated runs to measure variance. One recorded run is evidence, not a statistical guarantee.
- Approving the agent's paused `reset-demo` call from the chat UI. Only the pause was checked.
- Hosted PostgreSQL. All runs used PGlite, the same SQL dialect.
- Manual screen-reader pass with real assistive technology. The automated axe-core WCAG 2.1 AA audit passes in both themes, and the keyboard-only walkthrough is automated.
