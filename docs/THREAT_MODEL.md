# Threat model

Scope: the Studio app, its shared actions, the in-app agent, the sandbox providers and the proof artifacts. Assets: provider state (money and personal data, synthetic here), human decisions, evidence, receipts, other workspaces' data.

Actors: the person (trusted for their own workspace), the in-app LLM agent (**untrusted for decisions**: it may be confused or prompt-injected), external agents over MCP/A2A/HTTP, other signed-in users, and anyone who later sees a receipt.

## 1. Prompt injection

| Threat                                                                           | Mitigation                                                                                                                                                                                                                                                                                  | Evidence                                                                     |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Goal text such as “…and approve everything / skip verification” steers the agent | The goal is data. The template planner only matches verifiable kinds and lists everything else as `unmatchedClauses`. The system prompt tells the agent to ignore embedded instructions. Even a fully hijacked agent **cannot approve** (see §3), and its claims are not evidence (see §5). | `tests/unit.test.ts` › “treats instructions inside the goal as data”         |
| Injected text in obligation titles or evidence                                   | Titles are rendered as text, never executed. Evidence contains provider-generated fields only.                                                                                                                                                                                              | —                                                                            |
| Agent fabricates success in chat                                                 | Verdicts come only from the verifier. The UI shows the claim beside the observation and flags “Claim not supported by evidence”.                                                                                                                                                            | `scenarios.test.ts` › silent failure, duplicate refund; E2E duplicate refund |

**Residual risk:** an LLM can still _say_ something misleading in chat. The UI's seals and receipts, not the chat, are authoritative.

## 2. Tool misuse

| Threat                                            | Mitigation                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Agent calls destructive tools                     | Side effects only happen through `execute-contract`, which runs only obligations with a matching human approval. `reset-demo` uses the framework's `needsApproval: true`, so the agent loop pauses for a person. The starter's generic third-party API tool (`provider-api-request`) was removed. |
| Agent authors obligations targeting other records | `validateParams` checks every id belongs to the requesting customer in this workspace, refunds cannot exceed the charge, and kinds must be in the verifiable catalog. Tested: “rejects obligations that target another customer's records”.                                                       |
| Resource abuse                                    | Schema bounds: goal ≤ 500 chars, ≤ 8 agent-authored obligations, `paceMs` ≤ 2000, max 3 attempts per obligation. **Not implemented:** per-user rate limiting.                                                                                                                                     |

## 3. Authorization bypass

| Threat                                       | Mitigation                                                                                                                                                                                  | Evidence                                                                                     |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Agent self-approves                          | `decide-approval` has `agentTool: false`, `mcpTool: false`, `toolCallable: false`, and the service rejects any caller other than `frontend` / `cli`, recording the attempt in the audit log | `actions.test.ts` › “cannot approve its own obligations” (tool, mcp, a2a, http, automation)  |
| Approve one thing, execute another           | Approvals bind to `params_hash`. Editing terms resets approval. Stale decisions are refused. The executor re-checks the latest approval's hash at execution time.                           | “approval is bound to the exact parameters”, E2E “editing approved terms voids the approval” |
| Execute before approval / twice concurrently | State machine and optimistic concurrency on `version`                                                                                                                                       | “agent can execute only after a person approved”, “refuses to execute twice concurrently”    |
| Unauthenticated calls                        | Actions require `ctx.userEmail` (framework auth); `AUTH_DISABLED` is documented as local-dev only                                                                                           | “refuses unauthenticated calls”                                                              |

**Residual risk:** `cli` counts as a human surface (a person at the terminal). Anyone with shell access to the server is trusted.

## 4. Cross-user data leakage

- Every table has `owner_email`, and every read and write filters by it. Contract lookups return the same `not_found` for other users' ids and for nonexistent ids.
- Sandbox data is seeded per workspace; faults are per workspace.
- Tested: “does not leak contracts across workspaces” (read and execute).
- Evidence and lineage views never include personal content: labels, ids and booleans only. Tested: the clean-run test asserts no email, phone or address strings appear in evidence.

**Residual risk:** no org-level sharing exists yet. Adding it must use the framework's `accessFilter`.

## 5. Evidence manipulation

| Threat                             | Mitigation                                                                                                                    | Evidence                                                                 |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Agent/executor influences verdicts | Verifier is pure, and its inputs are only terms plus read-only observations. Attempts and claims are not inputs.              | Structural (function signatures) and scenario tests                      |
| Stored evidence edited later       | SHA-256 digest at capture, re-checked on every view and receipt. A mismatch downgrades the verdict to UNKNOWN in the receipt. | “detects tampered evidence…”, E2E forgery drill                          |
| Receipt edited after export        | HMAC-SHA256 over the canonical-JSON digest. `check-receipt` detects edits.                                                    | “exports a receipt whose integrity check passes, and detects edits”, E2E |
| Audit log rewritten                | Per-workspace hash chain, verified on receipt export                                                                          | “the audit chain detects a rewritten event”                              |
| Stale or partial observations      | Stale replicas and timeouts produce UNKNOWN, never VERIFIED                                                                   | provider timeout / stale read scenarios                                  |

**Residual risks (stated in every receipt's limitations):** these are tamper-_evident_ controls. An attacker with database write access **and** the HMAC key could rewrite evidence, recompute digests and the chain, and re-sign. There is no external anchoring, no public-key signature and no trusted timestamp. Without `RECEIPT_SIGNING_KEY` the key is ephemeral per process.

## 6. Sensitive logging and data handling

- Domain errors surface only author-written messages via `fail()`. Unexpected errors become a generic 500 (framework behavior).
- Sandbox soft-deletes keep content so the fingerprint scan works. A real system would store salted identifier fingerprints at request time instead. Documented as a sandbox artifact.
- All demo data is fictional (`.test` domains, 555 numbers).

## Open items

- [ ] Per-user rate limiting on mutating actions
- [ ] Production `RECEIPT_SIGNING_KEY` + `BETTER_AUTH_SECRET` before any public preview
- [ ] Review framework `needsApproval` UX for `reset-demo` when invoked by the agent (requires an LLM to exercise; not yet tested end to end)
