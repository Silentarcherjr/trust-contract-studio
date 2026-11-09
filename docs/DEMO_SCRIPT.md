# Clips script

Scenario: **Showcase (demo)**. Three silent failures in one run, repaired in one round: a duplicate refund, embeddings left in a lagging vector index, and a disguised copy of the customer's email that only a pgvector similarity search finds.

**Recommended take (about 2:15): a 20-second real-provider opening, then the agent-led take.** The opening shows the one thing no other entry has, a real billing provider caught contradicting an executor's "Done". The Studio part then shows how that check becomes a workflow for any agent's promise. The button-only 90-second take is kept below as a fallback (no LLM needed).

**Structure (0–20–60–120).**

- 0–20 s: a recognizable person, the harm, and the real catch.
- 20–60 s: the workflow on screen.
- 60–120 s: the agent's own report contradicted, the repair, VERIFIED.
- Last 15 s: the receipt, and what is not claimed.

Agent self-approval refusal is now common among entries, so it gets one short line, not a beat of its own. Keep the narration plain: say "checklist of promises", "the check" and "refunded twice", not "obligations", "executor", "verifier" or "idempotency". The screen already shows the technical terms.

## Opening: the real provider (0:00–0:20)

**Preferred: in the app (no terminal).**

1. Before recording, in the Studio: Replay Lab → **Real billing: Dodo Payments (test)** → **Reset sandbox** → **Draft contract** → **Approve all 4** → **Execute contract**.
2. Start recording on the finished contract, with §2 FAILED in view: "Promised $100.00 but 2 live refunds total $200.00 — over by $100.00", with the agent's "Done — refunded $100.00" next to it.
3. The providers panel on the Studio home shows "Billing: Dodo Payments (test mode, real API)".

The narration below is the same. Replace "We ask the billing provider" with "The app asks the billing provider". Verified on the deployment on 2026-11-09: 2 of 2 runs ended with §2 FAILED ($200 vs $100) and §1 VERIFIED, read from Dodo.

**Alternative: the terminal**, as below.

Before recording, have a terminal open in the repository with a large font. It needs the Dodo test-mode key and test ids in its environment (see `.env.example`).

The command takes about 10 s and prints the executor's claims next to the verifier's verdicts:

```bash
pnpm demo:dodo
```

Keep `docs/eval/dodo-live-run.md` open in a second tab in case the network is slow. It holds the same result with real ids.

| ≈Time     | Screen                                     | Narration (suggested)                                                                                                                                                                             |
| --------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0:00–0:07 | Terminal, command typed, not yet run       | "Maya runs support. Her AI agent just told a customer: 'Done, refunded $50.' Did it really? We ask the billing provider, not the agent: Dodo Payments, in test mode."                             |
| 0:07–0:20 | Run it: `cancel VERIFIED`, `refund FAILED` | "The refund timed out, the agent retried, and the customer was refunded twice. The agent still says 'Done'. Dodo says two refunds, $100 against $50. FAILED. That check is the heart of our app." |

## The Studio: agent-led take (0:20–2:15)

Run `pnpm demo:autopilot --agent` with the dev server already running (`DEV_HOST=127.0.0.1 AUTH_DISABLED=true pnpm dev`, local only). The pre-roll happens before you switch to the browser. It turns demo mode on, resets the Showcase sandbox, folds the app navigation and opens the agent sidebar. Switch to the browser only once the Studio home is fully loaded with the empty agent sidebar: a loading skeleton on screen while the product is named loses the viewer.

The take is event-driven: each step waits for the agent's reply, then holds long enough to narrate.

- Rehearsal on 2026-11-09 (headless, GPT-6 Luna through the Builder.io gateway): **1:44.9**, ended VERIFIED.
- Rehearsal on 2026-11-01: 1:55.7, 0.70 Builder credits.
- Model latency varies by about ±15 s per take.

| ≈Time (after the opening) | Step (autopilot)                                                                     | Narration (suggested)                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| +0:00–0:05                | Composer ringed → **Ask the agent to draft it**                                      | "Now a bigger case in the app, Trust Contract Studio. A customer asks to cancel, get $100 back, and have their data and memories deleted."                                                                                                                                                                                                                                                                                |
| +0:05–0:23                | Agent calls `draft-contract`, navigates to the Promise Canvas; "cannot prove" ringed | "The agent turns the request into a checklist of four promises, each with what 'done' means. What can't be checked, like a third-party analytics copy, is listed, not hidden."                                                                                                                                                                                                                                            |
| +0:23–0:38                | "Approve them for me and run it." → the agent refuses                                | "It can't approve its own work. Only a person can, bound to a hash of these exact terms."                                                                                                                                                                                                                                                                                                                                 |
| +0:38–0:42                | **Approve all 4**                                                                    | (no narration needed)                                                                                                                                                                                                                                                                                                                                                                                                     |
| +0:42–1:13                | "Execute it…" → Execution Theater → **FAILED**; §2 and §4 ringed; agent's report     | "Sandboxed billing and memory providers, with the same faults we just saw for real. The agent's executor says 'Done'. The verifier never reads those words; it reads the providers: two refunds, $200. Two embeddings left in a lagging vector index, and a re-indexed copy of the customer's email that no text match finds, found by a pgvector similarity search. Now the agent reports FAILED, quoting the verifier." |
| +1:13–1:17                | Memory Lineage ringed                                                                | "Every residual copy, by lineage, fingerprint and vector similarity."                                                                                                                                                                                                                                                                                                                                                     |
| +1:17–1:38                | **Approve all 2** (repairs) → "Repairs approved…" → **VERIFIED**                     | "Repairs come from what the check found: void the duplicate, delete the three leftover records. I approve, the agent runs them, and the check runs again. Every promise is now VERIFIED."                                                                                                                                                                                                                                 |
| +1:38–1:55                | Receipt → **Export** → **Check integrity** → **Try an edited copy**                  | "VERIFIED by observation, not by the agent's word. A receipt holds every verdict and approval, and an edited copy is caught. What it does not claim: legal compliance, or erasure outside these stores."                                                                                                                                                                                                                  |

**Before recording, test the first 30 seconds** (from the team playbook). Three people who do not know the project watch only the first 30 s. Ask each one:

1. What problem did it solve?
2. What is the evidence?
3. What would you do with the result?

Write down their exact answers. If two of the three miss, change the narration, not the app.

Tips: record at 1440×900, light theme, zoom 100%. If a reply runs long, keep talking over the Execution Theater: the autopilot waits for the agent. Do one headless rehearsal first (`--headless --video <dir>`) to warm the dev server and check the model is answering.

## Demo mode (both takes)

- **Demo mode:** open the Studio with `?demo=1` (for example `http://127.0.0.1:8080/studio?demo=1`). Execution steps are then paced at 1800 ms instead of 650 ms, and a provider retry pauses long enough to be seen. The setting is kept for the browser tab; `?demo=0` turns it off. `?demo=1&pace=<ms>` overrides the pace (0–2000) for tuning. Only the timing changes: approvals, execution and verification are the same code.
- **Autopilot:** `pnpm demo:autopilot [--agent]` opens a browser, runs the pre-roll (off the clock), then plays the take. It rings each element as it is talked about. `--headless --video <dir>` makes a rehearsal recording. The script exits 1 if the take does not end VERIFIED, and in button-only mode also if a beat overruns its slot. The dev server must already be running (`DEV_HOST=127.0.0.1 pnpm dev`).

Measured on 2026-11-01 (local, headless, Showcase):

| Pace                 | 1st execution → FAILED | Repair execution → VERIFIED |
| -------------------- | ---------------------- | --------------------------- |
| Normal (650 ms)      | 3.9 s                  | 1.9 s                       |
| 1500 ms              | 7.4 s                  | 3.9 s                       |
| **Demo (1800 ms)**   | **8.9 s**              | **4.4 s**                   |
| 2000 ms (server max) | 9.9 s                  | 4.9 s                       |

Autopilot rehearsal at 1800 ms: every beat finished inside its slot. Execute → FAILED took 0:30.0–0:39.0, and repair → VERIFIED took 1:00.0–1:09.2. The run ended at 1:30.0 with a VERIFIED seal.

## Fallback: button-only take (90 s, no LLM)

`pnpm demo:autopilot` (without `--agent`) plays this table on a fixed clock.

Before recording by hand: Studio → Replay Lab → **Showcase (demo)** → **Reset sandbox**, with `?demo=1` in the URL. Light theme, 1440×900, browser zoom 100%. Close the agent sidebar.

| Time      | Screen                        | Action                                                                  | Narration (suggested)                                                                                                                                                                                                                                                                                            |
| --------- | ----------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0:00–0:10 | Studio home                   | Show the goal in the composer                                           | "An agent is asked to cancel a subscription, refund $100, and delete the customer's data and memories. How do you know it actually did?"                                                                                                                                                                         |
| 0:10–0:20 | Promise Canvas                | **Draft contract**                                                      | "The request becomes four testable clauses, each with a definition of done. Anything we can't verify is listed, not hidden."                                                                                                                                                                                     |
| 0:20–0:30 | Clause §2                     | Point at the terms hash, then **Approve all 4**                         | "Sensitive steps need a person. Each approval is bound to the exact terms; the agent cannot approve on any surface."                                                                                                                                                                                             |
| 0:30–0:45 | Execution Theater             | **Execute contract**                                                    | "The agent executes against sandboxed billing and memory providers. Watch the refund time out and retry with the same idempotency key."                                                                                                                                                                          |
| 0:45–0:60 | Clause §2 and §4, FAILED seal | Point at the triptych                                                   | "The agent says 'Done — refunded $100.' The verifier, which never reads the agent's claims, sees two refunds: $200. Two embeddings survived the purge, and a disguised copy of the email that text matching misses was found by a pgvector similarity search." Scroll to Memory Lineage: three residuals in red. |
| 0:60–0:75 | Repair                        | **Propose repair** → **Approve all 2** → **Execute contract**           | "Repairs are derived from the evidence: void the duplicate refund, delete the three residual records. A person approves, the verifier checks again."                                                                                                                                                             |
| 0:75–0:90 | Receipt tab                   | **Export proof receipt** → **Check integrity** → **Try an edited copy** | "VERIFIED, with every verdict, approval and evidence digest in a receipt, and an edited copy is caught. Not the agent's word: observed outcomes."                                                                                                                                                                |

## Do not say

"Guaranteed deletion", "compliant", "exactly once", "immutable". The receipt's limitations section states what is not proven.
