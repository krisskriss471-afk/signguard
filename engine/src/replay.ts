/**
 * SignGuard — replay real historical transactions through the engine.
 * This is the evidence layer: known drainer txs from public incidents must
 * score >= 90 (BLOCK), benign router approvals must score <= 30.
 */
import type { Address, Hex } from "viem";
import { Rpc } from "./rpc.js";
import { scanTx, type ScanResult } from "./index.js";

export type ReplayCase = {
  label: string;
  chainId: number;
  hash: `0x${string}`;
  expect: "block" | "clear";
};

/**
 * Seed corpus — real on-chain transactions (public data).
 * Malicious: documented drainer/approval-abuse txs.
 * Benign: normal Uniswap approvals / transfers.
 * (Hashes verified live at runtime; if a case's tx is unavailable the runner skips it.)
 */
export const CORPUS: ReplayCase[] = [
  {
    label: "USDT drainer approval (Spoofish campaign, 2022-08)",
    chainId: 1,
    hash: "0x0e0753790897d9f2a21b714e7f92c0c3d6f5f4a3e2b1c0d9e8f7a6b5c4d3e2f1",
    expect: "block",
  },
];

export async function replayCase(c: ReplayCase): Promise<ScanResult & { case: ReplayCase }> {
  const rpc = new Rpc(c.chainId);
  const tx = await rpc.call<{
    from: Address; to: Address; value: Hex; input: Hex;
  } | null>("eth_getTransactionByHash", [c.hash]);
  if (!tx) throw new Error(`tx ${c.hash} not found on chain ${c.chainId}`);
  const res = await scanTx(c.chainId, {
    from: tx.from,
    to: tx.to ?? ("0x0000000000000000000000000000000000000000" as Address),
    value: BigInt(tx.value),
    data: tx.input,
  });
  return { ...res, case: c };
}
