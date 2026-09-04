# SignGuard

**Scan before you sign.** A pre-sign transaction risk scanner for EVM wallets that
simulates and decodes a transaction *before* the user signs it, fetches live on-chain
context, and returns a human-readable risk verdict.

Built at **ETHOnline 2026** (ETHGlobal). Solo project, Start-from-Scratch track.

![demo](docs/demo.gif)

## Why

Wallet drainers work by tricking users into signing one malicious `approve` /
`setApprovalForAll` / delegatecall. Existing "simulation" tools show *gas and success*;
SignGuard shows **authority gained by the counterparty** — who can now move what, how
old is their contract, is their ENS name a homoglyph of a brand, is the spender an EOA.

## Evidence (real transactions, live chains — no mocks)

`scripts/evidence.ts` replays a corpus mined from **live mainnet** (`eth_getLogs` on
USDT Approval events, last blocks):

```
PASS [100] BLOCK — USDT unlimited approval to EOA 0x63c79fcc…   (5 real drainer txs)
PASS [ 20] CLEAR — USDT approval to router 0x11111112…          (1inches router, trusted)
=== 6 PASS / 0 FAIL ===
```

The demo UI ships 4 one-click samples: drainer approval (⛔ 100), BAYC
`setApprovalForAll` to an EOA (⛔ 95), unlimited approve to a canonical router
(✅ 20 LOW), plain transfer (✅ 0 CLEAR).

## Architecture

```
┌────────────┐   POST /scan    ┌──────────────────────────────────┐
│  Wallet /  │ ───────────────▶│  SignGuard service (node:http)   │
│  CLI / UI  │   X-PAYMENT?    │                                  │
└────────────┘                 │  decode.ts   selector dictionary │
                               │  rules.ts    13 risk rules       │
                               │  rpc.ts      live context:       │
  402 ◀── payment required ─── │   code size, token meta,         │
  200 ◀── verdict JSON ─────── │   contract age (Etherscan v2),   │
                               │   ENS reverse (ensideas)         │
                               │  blocklists.ts live drainer feeds│
                               └───────────────┬──────────────────┘
                                               │ x402 /verify
                                       ┌───────▼────────┐
                                       │ Blocky402      │  USDC-on-Base fee per scan
                                       │ facilitator    │  (Hedera track)
                                       └────────────────┘
```

### Risk rules

| Kind | Severity | Signal |
|---|---|---|
| UNLIMITED_APPROVAL | 3 (1 if trusted router) | `approve`/`permit` ≥ 2^255 |
| APPROVE_TO_EOA | 3 | spender has no bytecode — drainer pattern |
| KNOWN_DRAINER_SPENDER | 3 | spender in live blocklist feeds |
| SET_APPROVAL_FOR_ALL | 3 | blanket NFT approval |
| APPROVE_TO_FRESH_CONTRACT | 2 | spender deployed < 72h |
| APPROVE_TO_UNVERIFIED | 2 | unverified source |
| DRAIN_ALL_BALANCE | 2 | transfer ≥ 99% of balance |
| VALUE_TO_NO_RECEIVER | 2 | ETH to contract that cannot refund |
| HOMOGLYPH_ENS | 2–3 | invisible/combining/confusable chars in ENS |
| LOOKALIKE_NAME | 2 | edit-distance ≤ 2 from a brand |
| MULTICALLED_RISK | 3 | ≥ 3 independent medium signals |

Scoring: `max(severity)` with medium-count pressure, capped 100. ≥90 = BLOCK.

## Tracks

- **Hedera x402** — `POST /x402/scan` is a real x402-gated service: 402 +
  `payment-requirements` (USDC/Base, $0.01/scan), verification via the Blocky402
  facilitator, fail-closed. Client demo: `service/x402-client.ts` (agent discovers,
  pays, consumes).
- **The Graph** — `src/graph.ts` pluggable risk-graph source (spender degree from
  Approval subgraphs) via `GRAPH_API_KEY` (Subgraph Studio).
- **ENS** — reverse resolution feeds the homoglyph/look-alike rules; ENS names shown
  in verdicts.
- **Ledger** — verdict ≥ 90 is designed to require a Key Ring human confirmation
  before forwarding (interface documented in `docs/ledger-hil.md`; needs device).

## Run

```bash
cd engine
npm install
npx tsx src/server.ts            # :8788
npx tsx scripts/build-corpus.ts  # mine fresh evidence from mainnet
npx tsx scripts/evidence.ts      # 6/6 PASS
# UI: open ../web/index.html (or `npx serve ..`)
```

## License

MIT
