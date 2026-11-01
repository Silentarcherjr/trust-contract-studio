# Development log

Living log so progress survives context resets. Newest entries first.

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
