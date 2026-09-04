# Ledger human-in-the-loop design (Ledger AI Agents track)

SignGuard is the *risk signal*; the Ledger Key Ring is the *approval gate*.

## Flow

```
agent / wallet                    SignGuard service              Ledger Key Ring CLI
     │  POST /x402/scan (X-PAYMENT)  │                                  │
     │──────────────────────────────▶│ verdict score                    │
     │◀──────────────────────────────│                                  │
     │                               │                                  │
     │  if score >= 90 (BLOCK):      │                                  │
     │  wallet-cli ring approve      │                                  │
     │──────────────────────────────────────────────────────────────────▶
     │        device-backed human signature over the verdict hash       │
     │◀──────────────────────────────────────────────────────────────────
     │  only then: forward tx for signing                              │
```

## Why it fits the track

- "systems that ask for a human before anything irreversible" — an unlimited
  approval to an EOA is exactly that.
- The agent never holds the approval key: SignGuard hands the wallet a *scoped
  capability* (verdict hash + human confirmation), not a signing right.
- `wallet-cli ring` enrollment works on hosts with no USB (VPS/CI agent), which is
  the scenario the Ledger brief calls out.

## Integration point

`engine/src/index.ts` exposes `scanTx()`; a wallet adapter wraps it:

```ts
const v = await scanTx(chainId, tx);
if (v.score >= 90) {
  const ok = await ringConfirm(sha256(JSON.stringify(v))); // ledger-cli
  if (!ok) throw new Error("blocked by SignGuard + human review");
}
```

Device demo recorded separately (requires a Ledger / DMK enrollment).
