/**
 * The Graph integration (pluggable — active when GRAPH_API_KEY is set).
 *
 * Risk-graph signal: how many distinct token holders approved this spender
 * (from the standardized ERC-4626/ERC-20 approval subgraphs), and whether the
 * spender appears in the Messari standardized schema. One query, many protocols —
 * the standards-leverage point the Graph track judges.
 *
 * Falls back gracefully (undefined) so the engine never blocks on Graph availability.
 */
import type { Address } from "viem";

const GATEWAY = "https://gateway.thegraph.com/api";

export type GraphRiskSignal = {
  /** number of unique owners that granted this spender authority (approval-graph degree) */
  spenderApprovalDegree?: number;
  /** true when the spender is a protocol present in the standardized subgraph */
  standardizedProtocol?: boolean;
};

export async function graphRisk(
  spender: Address,
  apiKey = process.env.GRAPH_API_KEY,
  subgraphId = process.env.GRAPH_APPROVAL_SUBGRAPH,
): Promise<GraphRiskSignal | undefined> {
  if (!apiKey || !subgraphId) return undefined;
  try {
    const res = await fetch(`${GATEWAY}/api/${apiKey}/subgraphs/id/${subgraphId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query: `query($spender: Bytes!) {
          approvals(where: { spender: $spender }, first: 1000) {
            id
            owner
          }
        }`,
        variables: { spender: spender.toLowerCase() },
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return undefined;
    const j = (await res.json()) as { data?: { approvals?: { owner: string }[] } };
    const owners = new Set((j.data?.approvals ?? []).map((a) => a.owner.toLowerCase()));
    return { spenderApprovalDegree: owners.size, standardizedProtocol: true };
  } catch {
    return undefined;
  }
}
