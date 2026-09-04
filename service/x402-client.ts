/**
 * x402 client — the "agent pays for a scan" flow (Hedera track).
 *
 * 1. POST /x402/scan without payment -> 402 + accepts[]
 * 2. build an EIP-3009 transferAuthorization for USDC (Base), sign with the agent key
 * 3. retry with X-PAYMENT: base64({x402Version,scheme,network,payload})
 * 4. facilitator verifies & settles; server returns the verdict
 *
 * Set env: AGENT_PK (0x…), PAY_TO (merchant address). Uses viem wallets only —
 * no private key ever leaves this process.
 */
import { createWalletClient, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";

const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as Address;
const BASE_URL = process.env.SIGNGUARD_URL ?? "http://localhost:8788";

const pk = (process.env.AGENT_PK ?? "") as Hex;
if (!pk.startsWith("0x")) {
  console.error("AGENT_PK required (agent wallet key, test funds only)");
  process.exit(1);
}
const account = privateKeyToAccount(pk);
const client = createWalletClient({ account, chain: base, transport: http() });

async function discoverRequirements(body: unknown) {
  const res = await fetch(`${BASE_URL}/x402/scan`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.status !== 402) throw new Error(`expected 402, got ${res.status}`);
  const j = (await res.json()) as { accepts: any[] };
  return j.accepts[0];
}

/** EIP-3009 transferWithAuthorization payload (agent -> payTo, USDC 6dp). */
async function signPayment(req: any): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const auth = {
    from: account.address,
    to: req.payTo as Address,
    requestedAmount: BigInt(req.maxAmountRequired),
    nonce: ("0x" + Array.from(crypto.getRandomValues(new Uint8Array(32))).map((b) => b.toString(16).padStart(2, "0")).join("")) as Hex,
    signature: "transferWithAuthorization" as const,
    validAfter: BigInt(now - 60),
    validUntil: BigInt(now + 600),
    verifyingContract: USDC_BASE,
    salt: ("0x" + Array.from(crypto.getRandomValues(new Uint8Array(32))).map((b) => b.toString(16).padStart(2, "0")).join("")) as Hex,
  };
  const domain = { name: "USD Coin", version: "2", chainId: 8453, verifyingContract: USDC_BASE };
  const types = {
    TransferWithAuthorization: [
      { name: "from", type: "address" }, { name: "to", type: "address" },
      { name: "value", type: "uint256" }, { name: "validAfter", type: "uint256" },
      { name: "validUntil", type: "uint256" }, { name: "nonce", type: "bytes32" },
      { name: "salt", type: "bytes32" },
    ],
  };
  const signature = await client.signTypedData({ domain, types, primaryType: "TransferWithAuthorization", message: {
    from: auth.from, to: auth.to, value: auth.requestedAmount, validAfter: auth.validAfter,
    validUntil: auth.validUntil, nonce: auth.nonce, salt: auth.salt,
  }});
  const payload = { x402Version: 1, scheme: "exact", network: "base-eip155:8453", payload: { signature, authorization: auth } };
  return Buffer.from(JSON.stringify(payload)).toString("base64");
}

async function paidScan(body: unknown) {
  const req = await discoverRequirements(body);
  console.log(`discovered: ${req.maxAmountRequired} USDC atoms -> ${req.payTo}`);
  const payment = await signPayment(req);
  const res = await fetch(`${BASE_URL}/x402/scan`, {
    method: "POST",
    headers: { "content-type": "application/json", "X-PAYMENT": payment },
    body: JSON.stringify(body),
  });
  if (res.status === 402) { console.error("payment rejected:", (await res.text()).slice(0, 200)); process.exit(1); }
  const verdict = await res.json();
  console.log("PAID SCAN OK — verdict:", JSON.stringify(verdict, null, 2).slice(0, 400));
  const receipt = res.headers.get("x-payment-response");
  if (receipt) console.log("settlement receipt:", Buffer.from(receipt, "base64").toString("utf8").slice(0, 200));
}

await paidScan(JSON.parse(process.argv[2] ?? '{"chainId":1,"tx":{"from":"0x0000000000000000000000000000000000000001","to":"0xdac17f958d2ee523a2206206994597c13d831ec7","value":"0","data":"0x095ea7b300000000000000000000000063c79fccd0a21e4a4d87056a0efe3b85d8c373d4ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"}}'));
