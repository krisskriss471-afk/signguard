/**
 * Live drainer blocklist feed.
 * Pulls public, actively-maintained scam-address lists at engine startup
 * (no API key) and refreshes hourly. Feeds rules.KNOWN_DRAINERS.
 */
import { KNOWN_DRAINERS } from "../src/rules.js";

const FEEDS = [
  // polkadot-js/phishing — curated address+domain blocklist (public JSON, no key)
  "https://raw.githubusercontent.com/polkadot-js/phishing/master/all.json",
  // MetaMask eth-phishing-detect (domains; feeds the look-alike detector)
  "https://raw.githubusercontent.com/MetaMask/eth-phishing-detect/main/src/config.json",
];

function extractAddresses(text: string): string[] {
  return [...text.matchAll(/0x[a-fA-F0-9]{40}/g)].map((m) => m[0].toLowerCase());
}

export async function refreshBlocklists(): Promise<number> {
  let added = 0;
  for (const url of FEEDS) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) continue;
      const text = await res.text();
      for (const addr of extractAddresses(text)) {
        if (!KNOWN_DRAINERS.has(addr)) {
          KNOWN_DRAINERS.add(addr);
          added++;
        }
      }
    } catch {
      /* feed offline — engine still works with the rest */
    }
  }
  return added;
}

export function startBlocklistRefresh(intervalMs = 3_600_000): NodeJS.Timeout {
  const t = setInterval(() => void refreshBlocklists(), intervalMs);
  t.unref?.();
  return t;
}
