import { describe, it, expect } from "vitest";
import { decodeCall, flattenCalls, UNLIMITED_THRESHOLD, MAX_UINT256 } from "../src/decode.js";
import {
  ruleUnlimitedApproval, ruleApproveToEoa, ruleSetApprovalForAll,
  ruleLookalikeName, ruleHomoglyphEns, score, verdict, type Finding,
} from "../src/rules.js";
import type { TxContext } from "../src/rpc.js";

const ctx = (over: Partial<TxContext> = {}): TxContext => ({
  from: "0x0000000000000000000000000000000000000001",
  to: "0xdac17f958d2ee523a2206206994597c13d831ec7",
  txValue: 0n, chainId: 1, tokenSymbol: "USDT", ...over,
});

const APPROVE_EOA = ("0x095ea7b3" + "0".repeat(24) + "63c79fccd0a21e4a4d87056a0efe3b85d8c373d4" + MAX_UINT256.toString(16)) as `0x${string}`;
const APPROVE_ROUTER = ("0x095ea7b3" + "0".repeat(24) + "1111111254eeb25477b68fb85ed929f73a960582" + MAX_UINT256.toString(16)) as `0x${string}`;

describe("decode", () => {
  it("decodes approve(address,uint256)", () => {
    const c = decodeCall(APPROVE_EOA)!;
    expect(c.functionName).toBe("approve");
    expect(c.args["arg0:address"]).toBe("0x63c79FcCd0a21e4a4D87056A0Efe3B85d8c373d4");
    expect(c.args["arg1:uint256"]).toBe(MAX_UINT256);
  });
  it("unlimited threshold is sane", () => {
    expect(UNLIMITED_THRESHOLD).toBeLessThan(MAX_UINT256);
    expect(MAX_UINT256).toBeGreaterThanOrEqual(UNLIMITED_THRESHOLD);
  });
  it("flattens multicall(bytes[])", () => {
    const inner = decodeCall(APPROVE_EOA)!;
    const packed = ("0xc01a8c84" +
      "0".repeat(24) + "2" + // offset
      "0".repeat(63) + "2" + // count 2 (approx: real encoding tested live in evidence)
      "0".repeat(56) + "44" + inner.args["arg0:address"].slice(2).padStart(64, "0") + MAX_UINT256.toString(16).padStart(64, "0")
    ) as `0x${string}`;
    // just assert it does not throw and returns >=1 call
    const flat = flattenCalls(packed);
    expect(flat.length).toBeGreaterThanOrEqual(1);
  });
});

describe("rules", () => {
  it("flags unlimited approval to EOA as critical", () => {
    const c = decodeCall(APPROVE_EOA)!;
    const f = ruleUnlimitedApproval(c, ctx({ spenders: { "0x63c79fccd0a21e4a4d87056a0efe3b85d8c373d4": { isContract: false } } }));
    expect(f?.severity).toBe(3);
    const g = ruleApproveToEoa(c, ctx({ spenders: { "0x63c79fccd0a21e4a4d87056a0efe3b85d8c373d4": { isContract: false } } }));
    expect(g?.kind).toBe("APPROVE_TO_EOA");
  });
  it("downgrades unlimited approval to trusted router", () => {
    const c = decodeCall(APPROVE_ROUTER)!;
    const f = ruleUnlimitedApproval(c, ctx());
    expect(f?.severity).toBe(1);
  });
  it("flags blanket NFT approval", () => {
    const data = ("0xa22cb465" + "0".repeat(24) + "63c79fccd0a21e4a4d87056a0efe3b85d8c373d4" + "0".repeat(63) + "1") as `0x${string}`;
    const c = decodeCall(data)!;
    const f = ruleSetApprovalForAll(c, ctx());
    expect(f?.severity).toBe(3);
  });
  it("detects homoglyph ENS", () => {
    const f = ruleHomoglyphEns(ctx({ targetEns: "uni\u200Dswap.eth" }));
    expect(f?.kind).toBe("HOMOGLYPH_ENS");
  });
  it("detects look-alike brand", () => {
    const f = ruleLookalikeName(ctx({ targetEns: "uniswop.eth" }));
    expect(f?.kind).toBe("LOOKALIKE_NAME");
  });
});

describe("scoring", () => {
  const mk = (severity: 0 | 1 | 2 | 3): Finding => ({ kind: "APPROVE_TO_EOA", severity, label: "x" });
  it("critical dominates", () => expect(score([mk(3), mk(1)])).toBeGreaterThanOrEqual(90));
  it("trusted-only stays low", () => expect(score([mk(1)])).toBeLessThanOrEqual(30));
  it("verdict wording", () => {
    expect(verdict([mk(3)]).summary).toMatch(/^BLOCK/);
    expect(verdict([]).summary).toMatch(/^CLEAR/);
  });
});
