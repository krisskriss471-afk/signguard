/**
 * SignGuard engine — pre-sign transaction risk verdict.
 * scanTx(chainId, tx) -> Verdict with findings, score, summary.
 */
import type { Address, Hex } from "viem";
import { getAddress } from "viem";
import { flattenCalls, type DecodedCall } from "./decode.js";
import { buildContext, type TxContext } from "./rpc.js";
import { graphRisk } from "./graph.js";
import {
  ruleUnlimitedApproval, ruleApproveToEoa, ruleApproveToUnverified,
  ruleFreshContract, ruleKnownDrainer, ruleSetApprovalForAll,
  ruleDrainAllBalance, ruleValueToNoReceiver, ruleHomoglyphEns,
  ruleLookalikeName, verdict, type Finding,
} from "./rules.js";

export type ScanResult = {
  score: number;
  summary: string;
  findings: Finding[];
  decoded: { selector: string; signature: string }[];
  context: { tokenSymbol?: string; spenderAgeHours?: number; targetEns?: string };
};

const RULES: ((c: DecodedCall, ctx: TxContext) => Finding | null)[] = [
  ruleUnlimitedApproval, ruleApproveToEoa, ruleApproveToUnverified,
  ruleFreshContract, ruleKnownDrainer, ruleSetApprovalForAll,
  ruleDrainAllBalance, ruleValueToNoReceiver,
];

/** Addresses that gain authority from the calldata (approve/permit/setApprovalForAll spenders). */
function extractSpenders(calls: DecodedCall[]): Address[] {
  const out: Address[] = [];
  for (const c of calls) {
    if (["approve", "permit", "setApprovalForAll"].includes(c.functionName)) {
      const a = c.args["arg0:address"];
      if (typeof a === "string") {
        try { out.push(getAddress(a as Address)); } catch { /* skip */ }
      }
    }
  }
  return out;
}

export async function scanTx(
  chainId: number,
  tx: { from: Address; to: Address; value?: bigint; data?: Hex },
): Promise<ScanResult> {
  const calls = tx.data ? flattenCalls(tx.data) : [];
  const spenders = extractSpenders(calls);
  const ctx = await buildContext(chainId, {
    from: tx.from,
    to: tx.to,
    value: tx.value ?? 0n,
    spenders,
  });
  const findings: Finding[] = [];
  for (const c of calls) {
    for (const rule of RULES) {
      const f = rule(c, ctx);
      if (f) findings.push(f);
    }
  }
  for (const f of [ruleHomoglyphEns(ctx), ruleLookalikeName(ctx)]) if (f) findings.push(f);
  // The Graph risk signal (pluggable; no-op without GRAPH_API_KEY + subgraph id)
  for (const s of spenders.slice(0, 3)) {
    const g = await graphRisk(s).catch(() => undefined);
    if (g?.spenderApprovalDegree !== undefined && g.spenderApprovalDegree >= 50) {
      findings.push({
        kind: "MULTICALLED_RISK", severity: 2,
        label: `Spender ${s} already holds approvals from ${g.spenderApprovalDegree} distinct owners (approval-graph degree via The Graph)`,
        counterparty: s,
      });
    }
  }
  // composite: several mediums escalate
  const mediums = findings.filter((f) => f.severity === 2).length;
  if (mediums >= 3) findings.push({ kind: "MULTICALLED_RISK", severity: 3, label: `${mediums} independent medium-risk signals in one transaction` });
  const v = verdict(findings);
  return {
    ...v,
    findings,
    decoded: calls.map((c) => ({ selector: c.selector, signature: c.signature })),
    context: { tokenSymbol: ctx.tokenSymbol, spenderAgeHours: ctx.spenderAgeHours, targetEns: ctx.targetEns },
  };
}

export { replayCase, CORPUS, type ReplayCase } from "./replay.js";
