/**
 * Evidence runner — replays the real-transaction corpus through the engine.
 * PASS criteria: every malicious case scores >= 90 (BLOCK);
 * benign router approvals score <= 30.
 */
import { readFileSync } from "node:fs";
import { getAddress, type Address, type Hex } from "viem";
import { Rpc } from "../src/rpc.js";
import { scanTx } from "../src/index.js";

type Case = { label: string; chainId: number; hash: string; expect: "block" | "clear" };
const corpus = JSON.parse(readFileSync("fixtures/corpus.json", "utf8")) as { malicious: Case[]; benign: Case[] };

async function run(c: Case) {
  const rpc = new Rpc(c.chainId);
  const tx = await rpc.call<{ from: Address; to: Address | null; value: Hex; input: Hex } | null>(
    "eth_getTransactionByHash", [c.hash]);
  if (!tx) return { c, skipped: true as const };
  const res = await scanTx(c.chainId, {
    from: getAddress(tx.from),
    to: getAddress(tx.to ?? "0x0000000000000000000000000000000000000000"),
    value: BigInt(tx.value),
    data: tx.input,
  });
  return { c, res };
}

let pass = 0, fail = 0;
for (const c of [...corpus.malicious, ...corpus.benign]) {
  try {
    const { res, skipped } = await run(c);
    if (skipped) { console.log(`SKIP  ${c.label}`); continue; }
    const ok = c.expect === "block" ? res!.score >= 90 : res!.score <= 30;
    console.log(`${ok ? "PASS" : "FAIL"} [${res!.score}] ${c.expect.toUpperCase()} — ${c.label}`);
    ok ? pass++ : fail++;
  } catch (e) {
    console.log(`ERROR ${c.label}: ${String(e).slice(0, 80)}`);
    fail++;
  }
}
console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
process.exit(fail > 0 ? 1 : 0);
