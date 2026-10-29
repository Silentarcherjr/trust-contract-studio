# Visual Design Contract — "Ledger & Seal"

## Product mode

- Mode: `verify`. A person reviews what an agent promised, decides, and checks the outcome.
- Primary workflow: request → clauses → decision → execution → independent verdict → repair → receipt.

## Visual direction

- A contract reads like a document: clauses are numbered (§1, §2…) and set in a serif (Fraunces).
- Evidence reads like an instrument: hashes, ids, sources and timings in monospace (JetBrains Mono).
- Verdicts are stamped seals: VERIFIED (green ink), FAILED (vermilion), UNKNOWN (ochre with diagonal hatching, so uncertainty looks different, not only colored differently).
- The core composition is the **Promised / Claimed / Observed** triptych. The gap between the agent's claim and the observed evidence is the product's message.
- Warm paper background in light mode, ink-dark in dark mode. Tokens live in `app/studio.css` (`--tcs-*`).

## Guardrails

- One primary action per contract state (approve all → execute → repair → receipt).
- The agent's claim is always labeled as a claim and never styled as evidence.
- Respect reduced motion. Keep no horizontal page scroll at 390px (tested in E2E).
- No decorative gradients, glass, or hero art.
