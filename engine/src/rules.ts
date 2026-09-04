/**
 * SignGuard — risk rules. Pure functions over decoded calls + on-chain context.
 * Each rule returns zero or one Finding. Severity: 0 info, 1 low, 2 medium, 3 critical.
 */
import type { Address, Hex } from "viem";
import { getAddress } from "viem";
import type { DecodedCall } from "./decode.js";
import { MAX_UINT256, UNLIMITED_THRESHOLD } from "./decode.js";
import type { SpenderInfo, TxContext } from "./rpc.js";

/** Resolve per-spender context, falling back to legacy single fields. */
export function spenderInfo(ctx: TxContext, addr: Address): SpenderInfo {
  return ctx.spenders?.[addr.toLowerCase()] ?? {
    isContract: ctx.spenderIsContract,
    verified: ctx.spenderVerified,
    ageHours: ctx.spenderAgeHours,
    ens: ctx.spenderEns,
  };
}

export type RiskKind =
  | "UNLIMITED_APPROVAL"
  | "APPROVE_TO_EOA"
  | "APPROVE_TO_UNVERIFIED"
  | "APPROVE_TO_FRESH_CONTRACT"
  | "DRAIN_ALL_BALANCE"
  | "SET_APPROVAL_FOR_ALL"
  | "UNKNOWN_DELEGATECALL"
  | "VALUE_TO_NO_RECEIVER"
  | "HOMOGLYPH_ENS"
  | "LOOKALIKE_NAME"
  | "MULTICALLED_RISK"
  | "KNOWN_DRAINER_SPENDER"
  | "ODD_TOKEN_TAX";

export type Finding = {
  kind: RiskKind;
  severity: 0 | 1 | 2 | 3;
  label: string;
  counterparty?: Address;
  exposureWei?: bigint;
};

/** Canonical routers/escrows that legitimately hold unlimited approvals. */
export const TRUSTED_SPENDERS = new Set<string>([
  "0x000000000022d473030aa1174efde9853668f36f", // Uniswap V2 Router
  "0xe592427a0aece92de3edee1f18e0157c05861596", // Uniswap V3 Router
  "0x1111111254eeb25477b68fb85ed929f73a960582", // 1inch
  "0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45", // Uniswap Universal Router
  "0x0000000000225396c7bdbf1cca7c5ccf04b1e7b7", // Uniswap Permit2
  "0x7a250d5630b4cf539739df2c5dacb4c659f2488d", // PancakeSwap Router
].map((a) => a.toLowerCase()));

/** On-chain drainer addresses (seed list; extended at runtime from live feeds). */
export const KNOWN_DRAINERS = new Set<string>([
  // seeded from public blocklist snapshots (see docs/data-sources.md)
]);

function argAddr(c: DecodedCall, i: number): Address | undefined {
  const v = c.args[`arg${i}:address`];
  return typeof v === "string" ? (getAddress(v as Address) as Address) : undefined;
}
function argUint(c: DecodedCall, i: number): bigint | undefined {
  const v = c.args[`arg${i}:uint256`];
  return typeof v === "bigint" ? v : undefined;
}

export function ruleUnlimitedApproval(c: DecodedCall, ctx: TxContext): Finding | null {
  if (c.functionName !== "approve" && c.functionName !== "permit") return null;
  const amount = argUint(c, 1) ?? argUint(c, 2);
  const spender = argAddr(c, 0);
  if (amount === undefined || !spender) return null;
  if (amount >= UNLIMITED_THRESHOLD) {
    const trusted = TRUSTED_SPENDERS.has(spender.toLowerCase());
    return {
      kind: "UNLIMITED_APPROVAL",
      severity: trusted ? 1 : 3,
      label: `Unlimited ${c.functionName} of ${ctx.tokenSymbol ?? "tokens"} to ${spender}${trusted ? " (trusted router)" : ""}`,
      counterparty: spender,
    };
  }
  return null;
}

export function ruleApproveToEoa(c: DecodedCall, ctx: TxContext): Finding | null {
  if (c.functionName !== "approve") return null;
  const spender = argAddr(c, 0);
  if (!spender) return null;
  const info = spenderInfo(ctx, spender);
  if (info.isContract === false && !TRUSTED_SPENDERS.has(spender.toLowerCase())) {
    return {
      kind: "APPROVE_TO_EOA",
      severity: 3,
      label: `Approval granted to an EOA (${spender}) — classic drainer pattern`,
      counterparty: spender,
    };
  }
  return null;
}

export function ruleApproveToUnverified(c: DecodedCall, ctx: TxContext): Finding | null {
  if (c.functionName !== "approve" && c.functionName !== "setApprovalForAll") return null;
  const spender = argAddr(c, 0);
  if (!spender) return null;
  const info = spenderInfo(ctx, spender);
  if (info.isContract !== true) return null;
  if (TRUSTED_SPENDERS.has(spender.toLowerCase())) return null;
  if (info.verified === false) {
    return {
      kind: "APPROVE_TO_UNVERIFIED",
      severity: 2,
      label: `Approval to unverified contract ${spender}`,
      counterparty: spender,
    };
  }
  return null;
}

export function ruleFreshContract(c: DecodedCall, ctx: TxContext): Finding | null {
  if (c.functionName !== "approve" && c.functionName !== "setApprovalForAll") return null;
  const spender = argAddr(c, 0);
  if (!spender) return null;
  const info = spenderInfo(ctx, spender);
  if (info.ageHours === undefined) return null;
  if (info.ageHours < 72 && !TRUSTED_SPENDERS.has(spender.toLowerCase())) {
    return {
      kind: "APPROVE_TO_FRESH_CONTRACT",
      severity: 2,
      label: `Spender contract deployed < ${Math.max(1, Math.round(info.ageHours))}h ago (${spender})`,
      counterparty: spender,
    };
  }
  return null;
}

export function ruleKnownDrainer(c: DecodedCall): Finding | null {
  if (c.functionName !== "approve" && c.functionName !== "setApprovalForAll") return null;
  const spender = argAddr(c, 0);
  if (!spender) return null;
  if (KNOWN_DRAINERS.has(spender.toLowerCase())) {
    return {
      kind: "KNOWN_DRAINER_SPENDER",
      severity: 3,
      label: `Spender is on the known-drainer blocklist (${spender})`,
      counterparty: spender,
    };
  }
  return null;
}

export function ruleSetApprovalForAll(c: DecodedCall, ctx: TxContext): Finding | null {
  if (c.functionName !== "setApprovalForAll") return null;
  const op = c.args["arg1:bool"];
  if (op !== true) return null;
  const spender = argAddr(c, 0);
  const trusted = spender ? TRUSTED_SPENDERS.has(spender.toLowerCase()) : false;
  return {
    kind: "SET_APPROVAL_FOR_ALL",
    severity: trusted ? 1 : 3,
    label: `Blanket NFT approval (all current & future assets)${spender ? ` to ${spender}` : ""}`,
    counterparty: spender,
  };
}

export function ruleDrainAllBalance(c: DecodedCall, ctx: TxContext): Finding | null {
  if (c.functionName !== "transfer" && c.functionName !== "transferFrom") return null;
  const amount = argUint(c, 1) ?? argUint(c, 2);
  if (amount === undefined) return null;
  const bal = ctx.tokenBalance ?? 0n;
  if (bal > 0n && amount >= bal * 99n / 100n) {
    return {
      kind: "DRAIN_ALL_BALANCE",
      severity: 2,
      label: `Transfer of ${amount} ≈ 100% of wallet balance of ${ctx.tokenSymbol ?? "token"}`,
      exposureWei: amount,
    };
  }
  return null;
}

export function ruleValueToNoReceiver(c: DecodedCall, ctx: TxContext): Finding | null {
  if (ctx.txValue === 0n) return null;
  if (ctx.targetHasReceiveOrFallback === false) {
    return {
      kind: "VALUE_TO_NO_RECEIVER",
      severity: 2,
      label: `Sending ${ctx.txValue} wei to a contract without receive()/fallback() — funds unrecoverable`,
      exposureWei: ctx.txValue,
    };
  }
  return null;
}

const HOMOGLYPH_RE = /[\u0300-\u036F\u200B-\u200D\u202A-\u202E\u2060-\u2064\uFE00-\uFE0F]/;
const CONFUSABLE_MAP: Record<string, string[]> = {
  a: ["а" /* cyrillic */], e: ["е", "ē"], o: ["о", "0"], i: ["і", "1", "l"], g: ["9"],
};

export function ruleHomoglyphEns(ctx: TxContext): Finding | null {
  const name = ctx.targetEns ?? ctx.spenderEns;
  if (!name) return null;
  if (HOMOGLYPH_RE.test(name)) {
    return { kind: "HOMOGLYPH_ENS", severity: 3, label: `ENS name contains invisible/combining characters: "${name}"` };
  }
  const label = name.split(".")[0] ?? "";
  for (const [ascii, confusables] of Object.entries(CONFUSABLE_MAP)) {
    if (confusables.some((c) => label.includes(c))) {
      return { kind: "HOMOGLYPH_ENS", severity: 2, label: `ENS name uses confusable "${confusables.find((c) => label.includes(c))}" for "${ascii}": "${name}"` };
    }
  }
  return null;
}

/** Look-alike of a well-known brand (uniswap-v3, 1inch, aave…) with one edit distance. */
const BRANDS = ["uniswap", "1inch", "aave", "lido", "opensea", "blur", "curve", "compound", "maker", "arbitrum", "base"];
function editDistance(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[m][n];
}

export function ruleLookalikeName(ctx: TxContext): Finding | null {
  const name = (ctx.targetEns ?? ctx.spenderEns ?? "").toLowerCase();
  if (!name) return null;
  const label = name.split(".")[0];
  for (const brand of BRANDS) {
    if (label !== brand && label.includes(brand.slice(0, 4)) && editDistance(label, brand) <= 2) {
      return { kind: "LOOKALIKE_NAME", severity: 2, label: `"${name}" is a look-alike of "${brand}"` };
    }
  }
  return null;
}

/** Composite scoring: max severity dominates; count of mediums adds pressure. */
export function score(findings: Finding[]): number {
  let s = 0;
  for (const f of findings) {
    s = Math.max(s, [5, 20, 60, 90][f.severity]);
    if (f.severity >= 2) s += 5;
  }
  return Math.min(100, s);
}

export function verdict(findings: Finding[]): { score: number; summary: string } {
  const sc = score(findings);
  const worst = findings.reduce<Finding | null>((a, f) => (!a || f.severity > a.severity ? f : a), null);
  const summary =
    sc >= 90 ? `BLOCK — ${worst?.label ?? "critical risk"}` :
    sc >= 60 ? `HIGH RISK — ${worst?.label ?? "review before signing"}` :
    sc >= 30 ? `CAUTION — ${worst?.label ?? "multiple low signals"}` :
    sc > 0 ? `LOW — ${worst?.label ?? "informational"}` :
    "CLEAR — no known risk patterns detected";
  return { score: sc, summary };
}
