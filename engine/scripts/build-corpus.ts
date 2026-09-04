/**
 * Corpus builder — mines REAL on-chain transactions for the evidence suite.
 * Malicious: USDT/USDC approvals whose spender is an EOA (drainer victims).
 * Benign:    approvals to canonical routers (Uniswap/1inch/Permit2).
 * Writes fixtures/corpus.json consumed by the vitest suite.
 */
import { writeFileSync } from "node:fs";
import { Rpc } from "../src/rpc.js";
import { TRUSTED_SPENDERS } from "../src/rules.js";

const USDT = "0xdac17f958d2ee523a2206206994597c13d831ec7" as const;
const APPROVAL_TOPIC = "0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925";

type Row = {
  label: string; chainId: number; hash: string; expect: "block" | "clear";
  spender: string; amount: string;
};

async function recentApprovals(rpc: Rpc, blocksBack: number) {
  const head = BigInt(await rpc.getBlockNumber());
  const out: { tx: string; owner: string; spender: string; value: bigint }[] = [];
  const WINDOW = 90n;
  for (let end = head; end > head - BigInt(blocksBack) && out.length < 400; end -= WINDOW) {
    const start = end - WINDOW;
    const logs = await rpc.call<{ transactionHash: string; data: string; topics: string[] }[]>(
      "eth_getLogs",
      [{ fromBlock: "0x" + start.toString(16), toBlock: "0x" + end.toString(16), address: USDT, topics: [APPROVAL_TOPIC] }],
    ).catch(() => []);
    for (const l of logs ?? []) {
      const owner = "0x" + l.topics[1].slice(26);
      const spender = "0x" + l.topics[2].slice(26);
      const value = BigInt(l.data);
      out.push({ tx: l.transactionHash, owner, spender, value });
    }
  }
  return out;
}

async function main() {
  const rpc = new Rpc(1);
  const rows = await recentApprovals(rpc, 4000);
  console.log(`scanned ${rows.length} USDT approvals`);
  const malicious: Row[] = [];
  const benign: Row[] = [];
  for (const r of rows) {
    const isUnlimited = r.value > (1n << 255n);
    const trusted = TRUSTED_SPENDERS.has(r.spender.toLowerCase());
    if (isUnlimited && !trusted) {
      // confirm spender is EOA (no code) -> drainer pattern
      const code = await rpc.getCode(r.spender as `0x${string}`).catch(() => "0x");
      if (code === "0x" && malicious.length < 5) {
        malicious.push({ label: `USDT unlimited approval to EOA ${r.spender.slice(0, 10)}…`, chainId: 1, hash: r.tx, expect: "block", spender: r.spender, amount: r.value.toString() });
      }
    } else if (trusted && benign.length < 5) {
      benign.push({ label: `USDT approval to router ${r.spender.slice(0, 10)}…`, chainId: 1, hash: r.tx, expect: "clear", spender: r.spender, amount: r.value.toString() });
    }
    if (malicious.length >= 5 && benign.length >= 5) break;
  }
  writeFileSync("fixtures/corpus.json", JSON.stringify({ malicious, benign }, null, 2));
  console.log(`corpus: ${malicious.length} malicious, ${benign.length} benign`);
}
main().catch((e) => { console.error(e); process.exit(1); });
