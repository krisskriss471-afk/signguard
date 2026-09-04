/**
 * Multi-network x402 configuration (Base + Arc).
 *
 * The Arc track wants stablecoin-native settlement on Circle's Arc L1. SignGuard's
 * paid endpoint is network-agnostic: pick the chain with X402_NETWORK and the matching
 * USDC asset / facilitator. Addresses are read from env so the repo never hardcodes
 * testnet/mainnet values that drift; defaults below are the documented Base mainnet
 * USDC and Arc testnet placeholders (fill ARC_USDC from docs.arc.io before mainnet).
 */
import type { Address } from "viem";

export type NetworkConfig = {
  id: string;            // x402 network identifier
  chainId: number;
  usdc: Address;
  facilitator: string;
  name: string;
};

export const NETWORKS: Record<string, NetworkConfig> = {
  base: {
    id: "base",
    chainId: 8453,
    usdc: (process.env.BASE_USDC ?? "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913") as Address,
    facilitator: process.env.X402_FACILITATOR ?? "https://blocky402.com",
    name: "USDC on Base",
  },
  arc: {
    id: "arc",
    chainId: Number(process.env.ARC_CHAIN_ID ?? 5042002), // Arc testnet (verified live: eth_chainId = 0x4cef52)
    usdc: (process.env.ARC_USDC ?? "0x3600000000000000000000000000000000000000") as Address, // Circle USDC precompile (verified: symbol() == "USDC")
    facilitator: process.env.ARC_FACILITATOR ?? "https://x402.arc.io",
    name: "USDC on Arc",
  },
};

export function pickNetwork(): NetworkConfig {
  const key = (process.env.X402_NETWORK ?? "base").toLowerCase();
  return NETWORKS[key] ?? NETWORKS.base;
}

/** EIP-3009 domain for the network's USDC (Circle uses name "USD Coin", version "2"). */
export function usdcDomain(cfg: NetworkConfig) {
  return { name: "USD Coin", version: "2", chainId: cfg.chainId, verifyingContract: cfg.usdc };
}
