# Differentiation: what is and is not new

Our research (46 rounds, private repo) found **no evidence that the concept is unprecedented**, and this document does not claim it. Each ingredient exists somewhere:

| Capability                                     | Already exists in                                                   | Our use                                                                                                                                                                          |
| ---------------------------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Human approval of agent tool calls             | Agent-Native `needsApproval` (this framework), most agent platforms | We use the framework gate for `reset-demo`, and add domain approvals bound to a terms hash, re-checked at execution                                                              |
| Action authority and signed proofs for refunds | Fidacy (action authority, signed proofs)                            | Our receipt proves **observed outcomes**, not authorization                                                                                                                      |
| Independent audits of agents                   | AgentProof                                                          | Our verification runs per request, live, in the user's workspace                                                                                                                 |
| Memory revocation and replay                   | Wrasse                                                              | We verify deletion by lineage closure _and_ identifier fingerprint, and report unobservable stores as UNKNOWN                                                                    |
| Action receipts and domain events              | Agent-Native `@agent-native/core/action-receipt` (commit receipts)  | Framework receipts prove a mutation committed. Ours prove the **promised outcome is observable in provider state**, including when the commit succeeded but the outcome is wrong |
| Agent tracing / evals                          | LangSmith, Braintrust, Langfuse                                     | Traces show what the agent did; we decide whether the promise was kept                                                                                                           |

## The claim we defend

> One workspace where a person and an agent turn a request into testable obligations, the person approves the risky ones, the agent executes, and **an executor-independent verifier** reports VERIFIED / FAILED / UNKNOWN from provider observations, then drives a human-approved repair loop to a receipt.

The parts we can demonstrate and test:

1. **Claim ≠ evidence, shown in the UI**: the Promised / Claimed / Observed triptych makes the gap visible (duplicate refund, silent no-op, contradictory renewal charge).
2. **UNKNOWN as a first-class verdict** with a reason: timeout, stale replica, unobservable store.
3. **Residual-memory detection** beyond the deletion API's answer: lineage closure plus identifier fingerprint.
4. **Repair proposals derived from verifier reasons**, approved by a person, followed by re-verification and a receipt with full history.

## Open risks to differentiation

- A judge may see it as “approvals + audit log”. The demo must lead with a failure the agent did not notice.
- Sandbox providers are ours, so the fault injection could look staged. Mitigation: faults live in providers, the verifier code is pure and small, and the Replay Lab shows expected vs observed.
