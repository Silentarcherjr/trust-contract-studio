# 90-second Clips script

Scenario: **Showcase (demo)**. Two silent failures in one run, repaired in one round.
Measured machine time from "Draft contract" to an intact receipt: **~8.5 s** (Playwright, local), so pacing is set by narration, not by the app.

Before recording: Studio → Replay Lab → **Showcase (demo)** → **Reset sandbox**. Light theme, 1440×900, browser zoom 100%. Close the agent sidebar.

| Time      | Screen                        | Action                                                                  | Narration (suggested)                                                                                                                                                                                                             |
| --------- | ----------------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0:00–0:10 | Studio home                   | Show the goal in the composer                                           | "An agent is asked to cancel a subscription, refund $100, and delete the customer's data and memories. How do you know it actually did?"                                                                                          |
| 0:10–0:20 | Promise Canvas                | **Draft contract**                                                      | "The request becomes four testable clauses, each with a definition of done. Anything we can't verify is listed, not hidden."                                                                                                      |
| 0:20–0:30 | Clause §2                     | Point at the terms hash, then **Approve all 4**                         | "Sensitive steps need a person. Each approval is bound to the exact terms; the agent cannot approve on any surface."                                                                                                              |
| 0:30–0:45 | Execution Theater             | **Execute contract**                                                    | "The agent executes against sandboxed billing and memory providers. Watch the refund time out and retry with the same idempotency key."                                                                                           |
| 0:45–0:60 | Clause §2 and §4, FAILED seal | Point at the triptych                                                   | "The agent says 'Done — refunded $100.' The verifier, which never reads the agent's claims, sees two refunds: $200. And two embeddings survived the purge in a lagging vector index." Scroll to Memory Lineage: residuals in red. |
| 0:60–0:75 | Repair                        | **Propose repair** → **Approve all 2** → **Execute contract**           | "Repairs are derived from the evidence: void the duplicate refund, delete the residual embeddings. A person approves, the verifier checks again."                                                                                 |
| 0:75–0:90 | Receipt tab                   | **Export proof receipt** → **Check integrity** → **Try an edited copy** | "VERIFIED, with every verdict, approval and evidence digest in a receipt, and an edited copy is caught. Not the agent's word: observed outcomes."                                                                                 |

## Agent variant (once an LLM is connected)

Replace 0:10–0:20 with: open the agent sidebar → "Draft a trust contract for this request" → the agent calls `draft-contract` and navigates to the canvas. Same action as the button.

## Do not say

"Guaranteed deletion", "compliant", "exactly once", "immutable". The receipt's limitations section states what is not proven.
