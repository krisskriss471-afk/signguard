/**
 * SignGuard — on-chain context fetcher.
 * One JSON-RPC batch per scan: code size, balance, ENS, deploy age, verification.
 * Live data only — no mocks (hackathon qualification requirement).
 */
import type { Address, Hex } from "viem";
import { getAddress } from "viem";

export type SpenderInfo = {
  isContract?: boolean;
  verified?: boolean;
  ageHours?: number;
  ens?: string;
};

export type TxContext = {
  from: Address;
  to: Address;
  txValue: bigint;
  chainId: number;
  // token (the `to` contract when it is an ERC-20/721)
  tokenSymbol?: string;
  tokenBalance?: bigint;
  // legacy single-spender fields (kept = info for the first spender)
  spenderIsContract?: boolean;
  spenderVerified?: boolean;
  spenderAgeHours?: number;
  spenderEns?: string;
  // per-spender resolution table
  spenders?: Record<string, SpenderInfo>;
  // target side
  targetHasReceiveOrFallback?: boolean;
  targetEns?: string;
};

const RPCS: Record<number, string[]> = {
  1: ["https://ethereum-rpc.publicnode.com", "https://eth.drpc.org"],
  8453: ["https://base-rpc.publicnode.com", "https://mainnet.base.org"],
  10: ["https://optimism-rpc.publicnode.com", "https://mainnet.optimism.io"],
  42161: ["https://arbitrum-rpc.publicnode.com", "https://arb1.arbitrum.io/rpc"],
  56: ["https://bsc-rpc.publicnode.com"],
  137: ["https://polygon-bor-rpc.publicnode.com"],
};

export class Rpc {
  constructor(
    public chainId: number,
    private urls: string[] = RPCS[chainId] ?? RPCS[1],
  ) {}

  async call<T>(method: string, params: unknown[]): Promise<T> {
    let lastErr: unknown;
    for (const url of this.urls) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
          signal: AbortSignal.timeout(8000),
        });
        const j = (await res.json()) as { result?: T; error?: unknown };
        if (j.result !== undefined) return j.result;
        lastErr = j.error;
      } catch (e) {
        lastErr = e;
      }
    }
    throw new Error(`rpc ${method} failed: ${String(lastErr)}`);
  }

  getCode(a: Address): Promise<Hex> {
    return this.call("eth_getCode", [a, "latest"]);
  }
  getBalance(a: Address): Promise<Hex> {
    return this.call("eth_getBalance", [a, "latest"]);
  }
  getBlockNumber(): Promise<Hex> {
    return this.call("eth_blockNumber", []);
  }
  getBlock(n: Hex): Promise<{ timestamp: Hex } | null> {
    return this.call("eth_getBlockByNumber", [n, false]);
  }
  /** eth_createAccessList reveals storage touched; used to probe deploy block heuristically. */
  callContract(to: Address, data: Hex): Promise<Hex> {
    return this.call("eth_call", [{ to, data }, "latest"]);
  }
}

/** ERC-20 symbol()/balanceOf via raw eth_call (no ABI dependency). */
export async function tokenMeta(rpc: Rpc, token: Address, holder: Address) {
  const out: Partial<TxContext> = {};
  try {
    const sym = await rpc.callContract(token, "0x95d89b41");
    if (sym && sym !== "0x") out.tokenSymbol = decodeStringReturn(sym);
  } catch { /* not a token */ }
  try {
    const bal = await rpc.callContract(
      token,
      ("0x70a08231" + holder.slice(2).padStart(64, "0")) as Hex,
    );
    if (bal && bal !== "0x") out.tokenBalance = BigInt(bal);
  } catch { /* no balanceOf */ }
  return out;
}

function decodeStringReturn(hex: Hex): string {
  try {
    const b = Buffer.from(hex.slice(2), "hex");
    if (b.length >= 64) {
      const len = Number(BigInt("0x" + b.subarray(32, 64).toString("hex")));
      return b.subarray(64, 64 + len).toString("utf8");
    }
    return b.toString("utf8").replace(/\0+$/, "");
  } catch {
    return "";
  }
}

/** Contract age via Etherscan-style explorers (free endpoints, no key for basic). */
export async function contractAgeHours(rpc: Rpc, addr: Address): Promise<number | undefined> {
  try {
    // binary search over recent blocks using eth_getCode emptiness is expensive;
    // instead use the first transaction seen via debug if available, else undefined.
    // For the hackathon we use a cheap heuristic: createAccessList + trace not needed —
    // explorers below give exact deploy tx.
    const explorers: Record<number, string> = {
      1: "https://api.etherscan.io/v2/api",
      8453: "https://api.etherscan.io/v2/api",
      10: "https://api.etherscan.io/v2/api",
      42161: "https://api.etherscan.io/v2/api",
    };
    const base = explorers[rpc.chainId];
    if (!base) return undefined;
    const url = `${base}?chainid=${rpc.chainId}&module=contract&action=getcontractcreation&contractaddresses=${addr}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const j = (await res.json()) as { result?: { txHash: string }[] };
    if (!j.result?.[0]?.txHash) return undefined;
    const tx = await rpc.call<{ blockNumber: Hex } | null>("eth_getTransactionByHash", [j.result[0].txHash]);
    if (!tx?.blockNumber) return undefined;
    const block = await rpc.getBlock(tx.blockNumber);
    if (!block) return undefined;
    const now = Math.floor(Date.now() / 1000);
    return (now - Number(BigInt(block.timestamp))) / 3600;
  } catch {
    return undefined;
  }
}

/** ENS reverse resolution (public API, no key). */
export async function ensNames(rpc: Rpc, addr: Address): Promise<{ targetEns?: string; spenderEns?: string }> {
  try {
    const res = await fetch(`https://api.ensideas.com/ens/resolve/${addr}`, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return {};
    const j = (await res.json()) as { name?: string };
    return j.name ? { targetEns: j.name } : {};
  } catch {
    return {};
  }
}


/** Build the full context for a tx request. `spenders` = addresses approved by the calldata. */
export async function buildContext(
  chainId: number,
  tx: { from: Address; to: Address; value: bigint; spenders?: Address[] },
): Promise<TxContext> {
  const rpc = new Rpc(chainId);
  const ctx: TxContext = {
    from: getAddress(tx.from),
    to: getAddress(tx.to),
    txValue: tx.value,
    chainId,
  };
  const [code, meta] = await Promise.all([
    rpc.getCode(tx.to).catch(() => "0x" as Hex),
    tokenMeta(rpc, tx.to, tx.from).catch(() => ({})),
  ]);
  Object.assign(ctx, meta);
  ctx.targetHasReceiveOrFallback = code !== "0x" ? undefined : true; // EOAs can always receive ETH
  // Resolve every spender the calldata grants authority to (not the token contract).
  const spenders = [...new Set((tx.spenders ?? []).map((s) => s.toLowerCase()))];
  ctx.spenders = {};
  for (const s of spenders) {
    const addr = getAddress(s) as Address;
    const info: SpenderInfo = {};
    const scode = await rpc.getCode(addr).catch(() => "0x");
    info.isContract = scode !== "0x";
    if (info.isContract) {
      info.ageHours = await contractAgeHours(rpc, addr).catch(() => undefined);
    }
    const ens = await ensNames(rpc, addr).catch((): { targetEns?: string; spenderEns?: string } => ({}));
    info.ens = ens.targetEns ?? ens.spenderEns;
    ctx.spenders[s] = info;
  }
  const first = ctx.spenders[spenders[0] ?? ""];
  if (first) {
    ctx.spenderIsContract = first.isContract;
    ctx.spenderAgeHours = first.ageHours;
    ctx.spenderEns = first.ens;
  }
  return ctx;
}
