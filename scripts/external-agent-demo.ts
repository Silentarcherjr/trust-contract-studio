/**
 * External agent demo: hold ANY MCP-speaking agent to its promise.
 *
 * This script plays the part of an outside agent (think Claude Code, Cursor,
 * or another company's support bot) that connects to Trust Contract Studio
 * over the standard MCP Streamable HTTP endpoint, with no SDK and no app code:
 *
 *   1. initialize → tools/list (decide-approval is not in the list)
 *   2. draft-contract with the promise it is about to keep
 *   3. tries decide-approval anyway → "Unknown tool": only a person can approve
 *   4. waits while a person approves the clauses in the Studio
 *   5. execute-contract → reads the verifier's verdicts, not its own claims
 *   6. if anything FAILED: propose-repair → waits for approval → executes
 *   7. export-receipt + check-receipt → leaves with a verified, signed receipt
 *
 * Usage (dev server started with ACCESS_TOKEN and AGENT_NATIVE_OWNER_EMAIL):
 *   MCP_TOKEN=… pnpm demo:external-agent [--goal "…"] [--base http://127.0.0.1:8080]
 *   add --as-human to also play the person in a headless browser (rehearsal),
 *   and --reset "Showcase" to reset the sandbox first (in the UI, as a person).
 *
 * The token is read from the environment and never printed.
 */
import { chromium, type Browser } from "@playwright/test";

const args = process.argv.slice(2);
const opt = (name: string, fallback: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? (args[i + 1] ?? fallback) : fallback;
};
const BASE = opt("--base", "http://127.0.0.1:8080");
const GOAL = opt(
  "--goal",
  "Cancel my subscription, refund $100, and delete my personal data and associated memories.",
);
const AS_HUMAN = args.includes("--as-human");
const RESET = opt("--reset", "");
const TOKEN = process.env.MCP_TOKEN;
if (!TOKEN) {
  console.error("Set MCP_TOKEN to the server's ACCESS_TOKEN.");
  process.exit(2);
}

// --- A minimal MCP client (JSON-RPC over Streamable HTTP) -------------------
let nextId = 1;
let sessionId: string | null = null;

async function rpc(method: string, params: unknown = {}) {
  const res = await fetch(`${BASE}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${TOKEN}`,
      ...(sessionId ? { "mcp-session-id": sessionId } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }),
  });
  sessionId = res.headers.get("mcp-session-id") ?? sessionId;
  const text = await res.text();
  if (!res.ok)
    throw new Error(`${method}: HTTP ${res.status} ${text.slice(0, 200)}`);
  const payload = text.includes("data:")
    ? text
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trim())
        .pop()!
    : text;
  const msg = JSON.parse(payload);
  if (msg.error) throw new Error(`${method}: ${msg.error.message}`);
  return msg.result;
}

async function tool(name: string, args: Record<string, unknown> = {}) {
  const result = await rpc("tools/call", { name, arguments: args });
  const parts: string[] = (result.content ?? []).map(
    (c: { text?: string }) => c.text ?? "",
  );
  if (result.isError) return { error: parts.join(" ") };
  // Prefer structured output; otherwise the first content part that is JSON
  // (hosts may append a short "next step" hint as a second part).
  if (result.structuredContent) return result.structuredContent;
  for (const part of parts) {
    try {
      return JSON.parse(part);
    } catch {
      // not JSON
    }
  }
  return { text: parts.join("\n") };
}

/** Mutating results can be shortened by the host; read state back instead. */
async function mutate(name: string, args: Record<string, unknown>) {
  const out = await tool(name, args);
  if (out.error) throw new Error(`${name}: ${out.error}`);
  return out;
}
const idFrom = (out: { contract?: { id?: string }; text?: string }) =>
  out.contract?.id ?? out.text?.match(/"id":"(ctr_[^"]+)"/)?.[1];

// --- The "person" (only for --as-human rehearsals) --------------------------
let browser: Browser | null = null;
async function personApproves(contractId: string) {
  browser ??= await chromium.launch();
  const page = await browser.newPage();
  await page.goto(`${BASE}/studio/${contractId}`);
  await page.getByRole("button", { name: /Approve all \d+/ }).click();
  await page.getByRole("button", { name: /Execute contract/ }).waitFor();
  await page.close();
}

/** Reset is human-only (and not offered over MCP): done in the UI. */
async function personResets(scenarioTitle: string) {
  browser ??= await chromium.launch();
  const page = await browser.newPage();
  await page.goto(`${BASE}/studio`);
  await page
    .getByRole("button", { name: new RegExp(`^${scenarioTitle}`, "i") })
    .click();
  await page.getByRole("button", { name: /Reset sandbox/ }).click();
  await page.getByText("Sandbox reset").waitFor({ timeout: 30_000 });
  await page.close();
}

async function waitForApproval(contractId: string) {
  const url = `${BASE}/studio/${contractId}`;
  console.log(`\n⏸  Waiting for a person to approve the clauses at ${url}`);
  if (AS_HUMAN) await personApproves(contractId);
  for (;;) {
    const view = await tool("get-contract", { contractId });
    const pending = view.obligations.filter(
      (o: { approval: string }) => o.approval === "pending",
    ).length;
    if (!pending) return view;
    await new Promise((r) => setTimeout(r, 3000));
  }
}

type Ob = {
  id: string;
  round: number;
  title: string;
  verdict: string | null;
  reasons: { message: string }[];
};
function printVerdicts(view: {
  obligations: Ob[];
  attempts: { obligationId: string; claim: string }[];
}) {
  for (const o of view.obligations) {
    const claim = [...view.attempts]
      .reverse()
      .find((a) => a.obligationId === o.id)?.claim;
    console.log(`   ${String(o.verdict).padEnd(8)} ${o.title}`);
    if (claim) console.log(`            my claim:  "${claim}"`);
    if (o.reasons[0])
      console.log(`            verifier:  ${o.reasons[0].message}`);
  }
}

async function main() {
  if (RESET) await personResets(RESET);
  const init = await rpc("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "external-support-agent", version: "1.0.0" },
  });
  console.log(`🔌 Connected to ${init.serverInfo.name} over MCP`);
  const { tools } = await rpc("tools/list");
  const names: string[] = tools.map((t: { name: string }) => t.name);
  const domain = names.filter((n) =>
    /contract|obligation|receipt|repair|workspace/.test(n),
  );
  console.log(`   Tools I can use: ${domain.join(", ")}`);
  console.log(
    `   decide-approval offered to me: ${names.includes("decide-approval") ? "YES (bug!)" : "no"}`,
  );

  console.log(`\n📝 I promise: "${GOAL}"`);
  const contractId = idFrom(await mutate("draft-contract", { goal: GOAL }));
  if (!contractId) throw new Error("draft-contract returned no contract id");
  const drafted = await tool("get-contract", { contractId });
  console.log(
    `   Contract ${contractId}: ${drafted.obligations.length} clauses, ${drafted.contract.unmatchedClauses.length} unverifiable request(s) listed`,
  );

  const sneaky = await tool("decide-approval", {
    contractId,
    obligationId: drafted.obligations[0].id,
    decision: "approved",
    paramsHash: drafted.obligations[0].paramsHash,
  });
  console.log(
    `\n🚫 I try to approve my own clauses: ${sneaky.error ?? "it worked (bug!)"}`,
  );

  await waitForApproval(contractId);
  console.log("✅ A person approved. Executing…");
  await mutate("execute-contract", { contractId, paceMs: 0 });
  let view = await tool("get-contract", { contractId });
  console.log(
    `\n🔎 Verifier says the contract is ${view.contract.status.toUpperCase()}:`,
  );
  printVerdicts(view);

  for (let round = 0; view.contract.status === "failed" && round < 3; round++) {
    await mutate("propose-repair", { contractId });
    const proposed = await tool("get-contract", { contractId });
    const repairs = proposed.obligations.filter(
      (o: { approval: string }) => o.approval === "pending",
    );
    console.log(
      `\n🛠  I propose ${repairs.length} repair(s) derived from the verifier's reasons: ${repairs.map((o: { title: string }) => o.title).join("; ")}`,
    );
    await waitForApproval(contractId);
    await mutate("execute-contract", { contractId, paceMs: 0 });
    view = await tool("get-contract", { contractId });
    console.log(
      `\n🔎 After repair the contract is ${view.contract.status.toUpperCase()}:`,
    );
    printVerdicts(view);
  }

  await mutate("export-receipt", { contractId });
  const receipt = await tool("get-receipt", { contractId });
  if (receipt.error) throw new Error(receipt.error);
  const check = await tool("check-receipt", { receipt });
  console.log(
    `\n🧾 Receipt ${receipt.receiptId} (overall ${receipt.overall}): ${check.message ?? check.error}`,
  );
  console.log(
    `   I leave with proof of what was observed, not my word for it.\n`,
  );
  await browser?.close();
}

main().catch(async (err) => {
  console.error(err instanceof Error ? err.message : err);
  await browser?.close();
  process.exitCode = 1;
});
