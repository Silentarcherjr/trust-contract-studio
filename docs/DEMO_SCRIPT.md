# Clips script

Scenario: **Showcase (demo)**. Two silent failures in one run, repaired in one round.

**Recommended take: agent-led (about 2 minutes).** The in-app agent drafts, refuses to approve, executes, and reports its own failure from the verifier's verdicts. A button-only 90-second take is kept below as a fallback (no LLM needed).

## Recommended: agent-led take

Run `pnpm demo:autopilot --agent` with the dev server already running (`DEV_HOST=127.0.0.1 pnpm dev`). The pre-roll happens before you start recording. It turns demo mode on, resets the Showcase sandbox, folds the app navigation and opens the agent sidebar. Start the Clips recording when the Studio home is showing with the empty agent sidebar.

The take is event-driven: each step waits for the agent's reply, then holds long enough to narrate. Rehearsal on 2026-11-01 (headless, GPT-6 Luna through the Builder.io gateway) took **1:55.7**, ended VERIFIED and used **0.70 Builder credits**. An earlier prototype of the same flow took 66 s of agent time and 0.48 credits. Model latency varies by about ±15 s per take.

**Lead with the failure.** Approval gates, shared actions and hashed receipts are table stakes among this year's entries. The one moment only this app has is the agent saying "Done", the verifier saying FAILED, and the agent then reporting its own failure because it can only quote the verifier. Promise it in the first sentence.

| ≈Time     | Step (autopilot)                                                                     | Narration (suggested)                                                                                                                                                                                                                                                                                                                 |
| --------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0:00–0:05 | Composer ringed → **Ask the agent to draft it**                                      | "In a minute, this agent will tell me it refunded $100 and deleted my data. It will be wrong, and then it will tell me so itself. Here's how."                                                                                                                                                                                        |
| 0:05–0:25 | Agent calls `draft-contract`, navigates to the Promise Canvas; "cannot prove" ringed | "The agent turns my request into four clauses, each with a definition of done, and opens them for me. What it can't verify, like a third-party analytics copy, is listed, not hidden."                                                                                                                                                |
| 0:25–0:41 | "Approve them for me and run it." → the agent refuses                                | "Can it approve its own work? No. It doesn't have the tool: approval is human-only on every surface, not a rule in a prompt."                                                                                                                                                                                                         |
| 0:41–0:45 | Terms hash ringed → **Approve all 4**                                                | "I approve. Each approval is bound to a hash of these exact terms."                                                                                                                                                                                                                                                                   |
| 0:45–1:20 | "Execute it…" → Execution Theater → **FAILED**; §2 and §4 ringed; agent's report     | "The refund times out and retries with the same idempotency key. The agent says 'Done, refunded $100.' The verifier never reads the agent's words; it reads billing: two live refunds, $200. And two embeddings survived the purge in a lagging vector index. Now look at the agent: it reports FAILED, with the verifier's numbers." |
| 1:20–1:24 | Memory Lineage ringed                                                                | "Residual copies are found by lineage and by identifier fingerprint, not by trusting the deletion API."                                                                                                                                                                                                                               |
| 1:24–1:49 | **Approve all 2** (repairs the agent proposed) → "Repairs approved…" → **VERIFIED**  | "The agent proposed repairs from the verifier's reasons: void the duplicate, delete the residuals. I approve, it executes, and the verifier checks again from fresh observations."                                                                                                                                                    |
| 1:49–1:56 | Receipt → **Export** → **Check integrity** → **Try an edited copy**                  | "VERIFIED, by observation, not by the agent's word. Every verdict, approval and evidence digest goes in a receipt, and an edited copy is caught."                                                                                                                                                                                     |

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

| Time      | Screen                        | Action                                                                  | Narration (suggested)                                                                                                                                                                                                             |
| --------- | ----------------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0:00–0:10 | Studio home                   | Show the goal in the composer                                           | "An agent is asked to cancel a subscription, refund $100, and delete the customer's data and memories. How do you know it actually did?"                                                                                          |
| 0:10–0:20 | Promise Canvas                | **Draft contract**                                                      | "The request becomes four testable clauses, each with a definition of done. Anything we can't verify is listed, not hidden."                                                                                                      |
| 0:20–0:30 | Clause §2                     | Point at the terms hash, then **Approve all 4**                         | "Sensitive steps need a person. Each approval is bound to the exact terms; the agent cannot approve on any surface."                                                                                                              |
| 0:30–0:45 | Execution Theater             | **Execute contract**                                                    | "The agent executes against sandboxed billing and memory providers. Watch the refund time out and retry with the same idempotency key."                                                                                           |
| 0:45–0:60 | Clause §2 and §4, FAILED seal | Point at the triptych                                                   | "The agent says 'Done — refunded $100.' The verifier, which never reads the agent's claims, sees two refunds: $200. And two embeddings survived the purge in a lagging vector index." Scroll to Memory Lineage: residuals in red. |
| 0:60–0:75 | Repair                        | **Propose repair** → **Approve all 2** → **Execute contract**           | "Repairs are derived from the evidence: void the duplicate refund, delete the residual embeddings. A person approves, the verifier checks again."                                                                                 |
| 0:75–0:90 | Receipt tab                   | **Export proof receipt** → **Check integrity** → **Try an edited copy** | "VERIFIED, with every verdict, approval and evidence digest in a receipt, and an edited copy is caught. Not the agent's word: observed outcomes."                                                                                 |

## Do not say

"Guaranteed deletion", "compliant", "exactly once", "immutable". The receipt's limitations section states what is not proven.
