/**
 * SignGuard HTTP service.
 *  POST /scan   { chainId, tx:{from,to,value,data} } -> verdict JSON
 *  POST /x402/scan  — same, but gated by the x402 payment protocol (Hedera/Arc tracks)
 *  GET  /health
 *
 * x402 flow (server side):
 *   1. client POSTs /x402/scan without payment -> 402 + payment requirements JSON
 *   2. client signs an EIP-3009 transferAuthorization for the fee and retries with X-PAYMENT header
 *   3. server verifies via facilitator, then executes the scan and returns it + X-PAYMENT-RESPONSE
 */
import { createServer } from "node:http";
import { getAddress, type Address, type Hex } from "viem";
import { scanTx } from "./index.js";
import { refreshBlocklists, startBlocklistRefresh } from "./blocklists.js";

const PORT = Number(process.env.PORT ?? 8788);
const FACILITATOR = process.env.X402_FACILITATOR ?? "https://blocky402.com";
const PAY_TO = process.env.X402_PAY_TO as Address | undefined;
const PRICE_USDC = process.env.X402_PRICE ?? "0.01"; // $0.01 per scan
const RPC_URL = process.env.RPC_URL ?? "https://ethereum-rpc.publicnode.com";

type Req = { chainId?: number; tx?: { from?: string; to?: string; value?: string; data?: string } };

function json(res: unknown & { writeHead(n: number, h?: Record<string, string>): void; end(s?: string): void }, code: number, body: unknown) {
  res.writeHead(code, { "content-type": "application/json", "access-control-allow-origin": "*" });
  res.end(JSON.stringify(body, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
}

/** Build x402 payment requirements (USDC on Base, per x402 v2). */
function paymentRequirements() {
  return {
    x402Version: 1,
    scheme: "exact",
    network: "base",
    maxAmountRequired: String(Math.round(Number(PRICE_USDC) * 1e6)), // USDC 6dp
    resource: "POST /x402/scan",
    description: "SignGuard pre-sign transaction risk verdict (one scan)",
    mimeType: "application/json",
    payTo: PAY_TO ?? "0x0000000000000000000000000000000000000000",
    maxTimeoutSeconds: 60,
    asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // native USDC on Base
    extraHeaders: { "X-PAYMENT": "required" },
  };
}

async function verifyPayment(header: string | undefined): Promise<{ ok: boolean; detail?: string }> {
  if (!header) return { ok: false, detail: "missing X-PAYMENT" };
  try {
    const res = await fetch(`${FACILITATOR}/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ paymentPayload: header, paymentRequirements: paymentRequirements() }),
      signal: AbortSignal.timeout(10000),
    });
    const j = (await res.json()) as { isValid?: boolean };
    return { ok: !!j.isValid, detail: JSON.stringify(j).slice(0, 120) };
  } catch (e) {
    // facilitator unreachable -> fail closed (never serve paid content unverified)
    return { ok: false, detail: `facilitator error: ${String(e).slice(0, 80)}` };
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "content-type,x-payment",
      "access-control-allow-methods": "POST,GET,OPTIONS",
    });
    return res.end();
  }
  if (url.pathname === "/health") return json(res, 200, { ok: true, service: "signguard", version: "0.1.0" });

  if (url.pathname === "/scan" || url.pathname === "/x402/scan") {
    if (url.pathname === "/x402/scan") {
      const pay = await verifyPayment(req.headers["x-payment"] as string | undefined);
      if (!pay.ok) {
        res.writeHead(402, { "content-type": "application/json", "x-payment-required": JSON.stringify(paymentRequirements()) });
        return res.end(JSON.stringify({ error: "payment required", accepts: [paymentRequirements()] }));
      }
    }
    let body = "";
    for await (const chunk of req) body += chunk;
    let parsed: Req;
    try { parsed = JSON.parse(body || "{}") as Req; } catch { return json(res, 400, { error: "bad json" }); }
    const { chainId, tx } = parsed;
    if (!chainId || !tx?.from || !tx?.to) return json(res, 400, { error: "chainId + tx{from,to} required" });
    try {
      const verdict = await scanTx(Number(chainId), {
        from: getAddress(tx.from),
        to: getAddress(tx.to),
        value: BigInt(tx.value ?? "0"),
        data: (tx.data ?? "0x") as Hex,
      });
      return json(res, 200, verdict);
    } catch (e) {
      return json(res, 502, { error: `scan failed: ${String(e).slice(0, 160)}` });
    }
  }
  json(res, 404, { error: "not found" });
});

await refreshBlocklists();
startBlocklistRefresh();
server.listen(PORT, () => console.log(`SignGuard service on :${PORT} (x402 facilitator=${FACILITATOR}, payTo=${PAY_TO ?? "unset"})`));
