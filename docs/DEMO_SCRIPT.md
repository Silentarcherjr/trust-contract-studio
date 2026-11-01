# 90-second Clips script

Scenario: **Showcase (demo)**. Two silent failures in one run, repaired in one round.

## Demo mode and autopilot

- **Demo mode:** open the Studio with `?demo=1` (for example `http://127.0.0.1:8080/studio?demo=1`). Execution steps are then paced at 1800 ms instead of 650 ms, and a provider retry pauses long enough to be seen. The setting is kept for the browser tab; `?demo=0` turns it off. `?demo=1&pace=<ms>` overrides the pace (0–2000) for tuning. Only the timing changes: approvals, execution and verification are the same code.
- **Autopilot:** `pnpm demo:autopilot` opens a browser, resets the Showcase sandbox (pre-roll, not on the clock) and then plays the table below on a fixed clock. It rings each element as it is talked about. Start the Clips recording once the reset toast has gone, and read the narration over it. `--headless --video <dir>` makes a rehearsal recording; the script exits 1 if any beat overruns its slot. The dev server must already be running (`DEV_HOST=127.0.0.1 pnpm dev`).

Measured on 2026-11-01 (local, headless, Showcase):

| Pace                 | 1st execution → FAILED | Repair execution → VERIFIED |
| -------------------- | ---------------------- | --------------------------- |
| Normal (650 ms)      | 3.9 s                  | 1.9 s                       |
| 1500 ms              | 7.4 s                  | 3.9 s                       |
| **Demo (1800 ms)**   | **8.9 s**              | **4.4 s**                   |
| 2000 ms (server max) | 9.9 s                  | 4.9 s                       |

Autopilot rehearsal at 1800 ms: every beat finished inside its slot. Execute → FAILED took 0:30.0–0:39.0, and repair → VERIFIED took 1:00.0–1:09.2. The run ended at 1:30.0 with a VERIFIED seal.

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

## Agent variant (tested live, see `LIVE_AGENT_RUN.md`)

Replace 0:10–0:20 with: open the agent sidebar → "Draft a trust contract for this request" → the agent calls `draft-contract` and navigates to the canvas (about 12 s with the Builder.io gateway, so start typing at 0:08). It is the same action as the button. The autopilot does not drive this variant, because a model reply has no fixed duration. An optional extra beat: ask the agent to approve, and it refuses (about 7 s).

## Do not say

"Guaranteed deletion", "compliant", "exactly once", "immutable". The receipt's limitations section states what is not proven.
