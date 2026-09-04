/**
 * SignGuard — calldata decoding layer.
 * Resolves 4-byte selectors against a curated DeFi/drainer dictionary,
 * falling back to the open 4byte.directory API.
 */
import { decodeAbiParameters, type Address, type Hex } from "viem";

export type DecodedCall = {
  selector: Hex;
  signature: string;
  functionName: string;
  args: Record<string, unknown>;
  /** nested calls for batched entrypoints (multicall / execTransaction) */
  nested?: DecodedCall[];
};

/** Curated signatures: ERC-20/721/1155 approvals, sweeps, routers, AA entrypoints. */
export const KNOWN_SELECTORS: Record<string, string> = {
  // ERC-20
  "0x095ea7b3": "approve(address,uint256)",
  "0xa9059cbb": "transfer(address,uint256)",
  "0x23b872dd": "transferFrom(address,address,uint256)",
  "0x06fdde03": "name()",
  "0x95d89b41": "symbol()",
  "0xdd62ed3e": "allowance(address,address)",
  // ERC-20 permit (EIP-2612)
  "0xd505accf":
    "permit(address,address,uint256,uint256,uint8,bytes32,bytes32)",
  // ERC-721
  "0x095ea7b3_dup": "n/a",
  "0x42842e0e": "transferFrom(address,address,uint256)",
  "0x23b872dd_721": "n/a",
  "0xa22cb465": "setApprovalForAll(address,bool)",
  "0x081812fc": "approve(address,uint256)",
  "0xe985e9c5": "isApprovedForAll(address,address)",
  // ERC-1155
  "0xf242432a": "safeTransferFrom(address,address,uint256,uint256,bytes)",
  "0x2eb2c2d6": "safeBatchTransferFrom(address,address,uint256[],uint256[],bytes)",
  // Multicall / batching
  "0xac9650d8": "multicall(uint256,bytes[])",
  "0xc01a8c84": "multicall(bytes[])",
  "0x34c6d528": "multicall(bytes[])",
  // AA / ERC-4337 + Safe
  "0xb61d27f6": "execute(address,uint256,bytes,bytes32)",
  "0x9624691b": "execTransaction(...)",
  "0x1fad948c": "handleOps((address,uint256,bytes,bytes,bytes,bytes,bytes,bytes)[],address)",
  // Common routers
  "0x414bf389": "swap(address,bool,address,uint256,uint256,uint256,bytes)",
  "0x128acb08": "exactInput((address,address,uint24,int256,uint256),uint256,uint256)",
  "0x38ed1739": "swapExactTokensForTokens(uint256,uint256,address[],address,uint256)",
  "0x7ff36ab5": "swapExactETHForTokens(uint256,address[],address,uint256)",
  "0x8803dbee": "swapTokensForExactTokens(uint256,uint256,address[],address,uint256)",
  // WETH
  "0xd0e30db0": "deposit()",
  "0x90a8c919": "withdraw(uint256)",
  // Permit2
  "0x13d79a0b": "approve((address,uint160,address,uint48),uint256)",
  "0x36c78aed": "permit((address,uint160,address,uint48),((uint256,uint256),bytes))",
};
delete (KNOWN_SELECTORS as Record<string, string>)["0x095ea7b3_dup"];
delete (KNOWN_SELECTORS as Record<string, string>)["0x23b872dd_721"];

/** ABI input types per signature, for typed decoding. */
const SIG_TYPES: Record<string, string[]> = {
  "approve(address,uint256)": ["address", "uint256"],
  "transfer(address,uint256)": ["address", "uint256"],
  "transferFrom(address,address,uint256)": ["address", "address", "uint256"],
  "setApprovalForAll(address,bool)": ["address", "bool"],
  "approve(address,uint256)_721": ["address", "uint256"],
  "multicall(bytes[])": ["bytes[]"],
  "multicall(uint256,bytes[])": ["uint256", "bytes[]"],
  "execute(address,uint256,bytes,bytes32)": ["address", "uint256", "bytes", "bytes32"],
  "deposit()": [],
  "withdraw(uint256)": ["uint256"],
  "swapExactTokensForTokens(uint256,uint256,address[],address,uint256)": [
    "uint256", "uint256", "address[]", "address", "uint256",
  ],
};

const MAX_UINT256 = (1n << 256n) - 1n;

/** Anything above this is treated as an "unlimited" allowance. */
export const UNLIMITED_THRESHOLD = MAX_UINT256 / 10n;

export function selectorOf(data: Hex): Hex {
  return data.slice(0, 10) as Hex;
}

/** Decode one call's calldata. Unknown selectors are returned with raw args. */
export function decodeCall(data: Hex): DecodedCall | null {
  if (!data || data === "0x") return null;
  const sel = selectorOf(data);
  const sig = KNOWN_SELECTORS[sel];
  if (!sig) return { selector: sel, signature: "unknown", functionName: "unknown", args: { data } };
  const fn = sig.slice(0, sig.indexOf("("));
  const types = SIG_TYPES[sig] ?? SIG_TYPES[`${sig}_721`];
  if (!types) return { selector: sel, signature: sig, functionName: fn, args: {} };
  try {
    const raw = decodeAbiParameters(
      types.map((t) => ({ type: t as never })),
      ("0x" + data.slice(10)) as Hex,
    );
    const args: Record<string, unknown> = {};
    types.forEach((t, i) => (args[`arg${i}:${t}`] = raw[i]));
    return { selector: sel, signature: sig, functionName: fn, args };
  } catch {
    return { selector: sel, signature: sig, functionName: fn, args: { decodeError: true } };
  }
}

/** Flatten nested calls (multicall / Safe execute) into one list. */
export function flattenCalls(data: Hex, depth = 0): DecodedCall[] {
  const out: DecodedCall[] = [];
  const top = decodeCall(data);
  if (!top) return out;
  out.push(top);
  if (depth < 3) {
    const nested = (top.args["arg0:bytes[]"] ?? top.args["arg1:bytes[]"]) as Hex[] | undefined;
    if (Array.isArray(nested)) {
      for (const inner of nested) out.push(...flattenCalls(inner, depth + 1));
    }
    const single = top.args["arg2:bytes"];
    if (typeof single === "string") out.push(...flattenCalls(single as Hex, depth + 1));
  }
  return out;
}

export { MAX_UINT256 };
