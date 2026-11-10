/**
 * Actions offered to external agents (Claude Code, Cursor, any MCP host).
 * They can draft, execute and read verdicts and receipts, so outside agents
 * can be held to their promises too. Never listed: decide-approval (human-only
 * on every surface), tamper-evidence (a drill) and reset-demo (destroys the
 * workspace). Tested in tests/actions.test.ts.
 */
export const MCP_CONNECTOR_CATALOG = [
  "get-workspace",
  "list-contracts",
  "get-contract",
  "draft-contract",
  "update-obligation",
  "add-obligation",
  "execute-contract",
  "verify-contract",
  "audit-transcript",
  "propose-repair",
  "export-receipt",
  "get-receipt",
  "check-receipt",
] as const;

export const NEVER_EXTERNAL = [
  "decide-approval",
  "tamper-evidence",
  "reset-demo",
] as const;
