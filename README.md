# Trust Contract Studio

**Agents make promises. This is where they get checked.**

For the support-ops lead whose AI agent handles refunds, cancellations and "delete my data" requests: check every "Done" against the provider's own records, not the agent's word.

**[Try it live](https://trust-contract-studio.vercel.app)** (sign up with any email; each account gets its own workspace) · **[Demo video (Clips, narrated, 2:47)](https://clips.agent-native.com/r/A3O7a6gFABwo)** · **[Earlier take without narration](https://clips.agent-native.com/r/3dXb1RkO1Hh4)** · **[Evidence](docs/eval/)** · **[Full overview](docs/OVERVIEW.md)**

**Caught on a real provider, and you can check it yourself.** An ordinary LLM support agent we did not script refunded $200 but never called cancel, then told the customer _"Your subscription is canceled immediately, and the full $200 refund succeeded."_ We left Dodo's records as the agent left them. On the [live app](https://trust-contract-studio.vercel.app), press **Audit a real agent's transcript**: the Studio reads that subscription at Dodo and answers **FAILED**, still active ([how](docs/eval/wild-agent-eval-confirm.md)).

<img src="docs/screenshots/17-real-agent-transcript-audit.png" width="720" alt="Live audit of a real, unscripted agent's transcript: the agent said 'Your subscription is canceled immediately', Dodo's records show it still active, FAILED" />

Below, the same check on a run of our own demo executor. An AI agent tells a customer _"Done: cancelled, refunded $100, and your data is deleted."_ Trust Contract Studio does not take its word. It asks the provider. Below, the provider is **Dodo Payments in test mode** (a real API with simulated money), for both the billing and the customer's profile:

- **The refund was paid twice.** The refund's response was lost and the call retried. Dodo documents no idempotency key, so the customer was refunded **$200**.
- **The phone number was not deleted.** The agent "deleted" the phone number by sending `null`. Dodo answered 200 and kept the number.

The agent said "Done"; the independent check says **FAILED** on both, from Dodo's own records.

What is staged and what is real:

| Case                               | Staged by us                    | Real at Dodo                                       |
| ---------------------------------- | ------------------------------- | -------------------------------------------------- |
| Unscripted agent's "$200 refunded" | Nothing: the agent's own words  | No call was made; $0 refunded, subscription active |
| Refund paid twice                  | The lost response and the retry | The second refund, paid                            |
| Phone number not deleted           | Sending `null` to delete it     | Dodo answered 200 and kept the number              |

To check an agent you did not write, paste its transcript into **Audit transcript**. All evidence is indexed in [docs/eval](docs/eval/).

![Claim against provider, on real Dodo Payments test mode: the agent said "Done, refunded $100.00", Dodo shows two refunds totalling $200; the agent said "personal data erased", Dodo still holds the phone number](docs/screenshots/16-claim-vs-provider-ledger.png)

## Try it in 30 seconds

1. Open the [live app](https://trust-contract-studio.vercel.app) and sign up.
2. The Studio home opens with a sample transcript in which a support bot says it cancelled, refunded $100 and deleted the customer's data. Press **Audit transcript**.
3. The Studio reads Dodo and the data stores. Every "Done" that did not happen comes back **FAILED**, with the evidence.

To watch the agent do the work instead: reset **Real billing**, then draft, approve and execute.

## What it does

- **Turns a request into promises a person approves.** Each clause states what "done" means. Approval is human-only and bound to a hash of the exact terms.
- **Checks outcomes, not words.** A pure verifier reads the providers and answers **VERIFIED**, **FAILED** or **UNKNOWN**. Repairs come from what it found, and a tamper-evident receipt records the result.
- **Audits any agent.** Paste another agent's transcript, and its completion claims become clauses the verifier checks. Nothing is executed ([more](docs/OVERVIEW.md#audit-any-agents-transcript)).
- **Keeps watching.** A scheduled framework automation re-checks kept promises. When a refund changes at Dodo after it was VERIFIED, the clause turns FAILED and a `tcs.verdict.changed` event fires ([more](docs/OVERVIEW.md#watch-kept-promises)).

<img src="docs/screenshots/12-audit-transcript-in-chat.png" width="640" alt="In the chat, the agent audits another bot's transcript: each 'Done' claim sits next to the verifier's FAILED verdict, with the refund read from dodo.payments.get" />

## Evidence

| Evidence                                     | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **An agent we did not script**               | A plain LLM support agent got Dodo's test-mode API as its only tools and 16 real support tickets, with no Studio and no injected fault. With a neutral prompt it was honest: 15 claims, all true, all VERIFIED. With one common house-style sentence ("always confirm what was done"), it told a customer _"Your subscription has been canceled, and I've issued a full $200 refund"_ **without making a single call**. The audit caught both claims from Dodo's records, with **0 false alarms** on the 14 true ones. [Report](docs/eval/wild-agent-eval-confirm.md) · [neutral run](docs/eval/wild-agent-eval.md) |
| **Real provider** (Dodo Payments, test mode) | 18 live runs, six executor behaviours (correct, retried refund, partial refund, wrong charge, cancel at period end, no-op), "Done" every time. **18/18 broken promises caught, 0 false alarms, 0 UNKNOWN.** An oracle on different Dodo endpoints agreed on every case. [Report](docs/eval/dodo-eval.md)                                                                                                                                                                                                                                                                                                            |
| **Real erasure at Dodo**                     | 12 live runs on fresh test customers, four executor behaviours (correct, phone "deleted" with null, name only, no-op), "Done" every time. **9/9 incomplete erasures caught, 0 false alarms on the 3 real ones.** An oracle on the customers list endpoint agreed on every case. [Report](docs/eval/dodo-erasure-eval.md)                                                                                                                                                                                                                                                                                            |

More evidence, each with what was staged and what was real, is in the [evidence index](docs/eval/README.md): the in-app LLM agent on Dodo, an LLM judge compared with the verifier, and a consistency check on our own sandbox, every combination of 9 injected faults (512 runs, 2,048 clauses), gave 0 false VERIFIED and 0 false FAILED ([report](docs/eval/outcome-eval.md)).

**What is real, and what is ours.** Billing and the customer's profile run on Dodo's real API in test mode (simulated money). Each workspace gets its own test customer at Dodo. The memory index is a real PostgreSQL + pgvector database. The customer and its records are synthetic. In the evaluations the executor and its mistakes are ours, but every outcome they leave at Dodo is real, and **Audit transcript** checks any agent's text, not only ours.

## Built on Agent-Native

Every capability is one `defineAction()` shared by the UI, the in-app agent and external agents over MCP. The safety rules are framework gates, not prompt instructions:

- **Only a person approves.** `decide-approval` is `uiOnly`, with `agentTool: false` and `mcpTool: false`, so only the signed-in UI can call it.
- **A seal on every "Done".** A chat renderer (`registerActionChatRenderer`) shows what the agent says next to what the verifier checked.
- **Events and automations.** `tcs.verdict.changed` is emitted on the framework event bus, the agent creates the watch with `manage-automations`, and workspace reset uses `needsApproval`.
- **Narrow tool surfaces.** The agent has no raw SQL (`frameworkTools: { database: "off" }`), and external agents get a curated MCP catalog that a test enforces. A [recorded external agent](docs/eval/external-agent-run.md) tried to approve itself and got "Unknown tool".

Details are in [docs/OVERVIEW.md](docs/OVERVIEW.md#agent-native-for-real).

**Dates.** Dates in this repository are UTC. The submission deadline, Nov 9, 2026 at 11:59 PM PT, is Nov 10 at 07:59 UTC, so work dated Nov 10 (UTC) is inside the window.

**Built during the event.** The only pre-existing code is the framework's Chat starter (`@agent-native/core` 0.222.0), scaffolded on Oct 29, 2026 (commit `6511b5f`). Everything after it was written during the event. Full disclosure: [docs/SUBMISSION.md](docs/SUBMISSION.md#pre-existing-materials-disclosure-final-review-2026-11-01).

## Quick start

Requirements: Node.js ≥ 22.22, pnpm (via `corepack enable`).

```bash
pnpm install
cp .env.example .env          # then set AUTH_DISABLED=true for local dev
pnpm dev                      # http://localhost:8080/studio
```

In containers without IPv6, start with `DEV_HOST=127.0.0.1 pnpm dev`. Agent chat needs an LLM (connect Builder.io in the app or set a provider key); the deterministic flow does not. Real billing needs the Dodo test-mode variables listed in `.env.example`.

The checks are:

- `pnpm typecheck`, `pnpm lint` and `pnpm format:check`;
- `pnpm test`: 98 unit and integration tests;
- `pnpm test:e2e`: 9 Playwright tests, including an axe-core audit and a keyboard-only run;
- `pnpm build`.

Latest results are in [docs/TEST_REPORT.md](docs/TEST_REPORT.md).

## Documentation

- [docs/OVERVIEW.md](docs/OVERVIEW.md): who it is for, transcript audit, watching kept promises, MCP, the action table
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md) · [docs/DIFFERENTIATION.md](docs/DIFFERENTIATION.md)
- [docs/TEST_REPORT.md](docs/TEST_REPORT.md) · [docs/DEVLOG.md](docs/DEVLOG.md) · [docs/SUBMISSION.md](docs/SUBMISSION.md)

## Honest limits

- Most scenarios run on sandbox providers with synthetic data. The **Real billing** scenarios use Dodo Payments in test mode for cancellations, refunds and the customer profile (name, email, phone); memories stay in the sandbox and the pgvector index. Verification covers only stores registered in the workspace. It is not evidence of erasure anywhere else and not a legal determination.
- Vector-index embeddings are lexical (hashed character trigrams), not a language model's. They catch reformatted copies of an identifier, not deep paraphrases.
- Exactly-once execution is **not** claimed. Side effects use idempotency keys and bounded retries, and the verifier catches what slips through.
- Integrity is tamper-_evident_: SHA-256 digests on evidence, a hash-chained audit log, HMAC-signed receipts. There is no public-key signature, external timestamping or immutability guarantee. Someone with database and key access could rewrite history.
