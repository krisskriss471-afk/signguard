/**
 * SignGuard CLI — scan a live tx by hash, or a synthetic tx from flags.
 *   npx tsx src/cli.ts --hash 0x... --chain 1
 *   npx tsx src/cli.ts --to 0x... --data 0x095ea7b3... --from 0x... --chain 1
 */
import { getAddress, type Address, type Hex } from "viem";
import { Rpc } from "./rpc.js";
import { scanTx } from "./index.js";

const argv: Record<string, string | boolean> = {};
{
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i++) {
    const tok = a[i];
    if (!tok.startsWith("--")) continue;
    const k = tok.slice(2);
    if (k.includes("=")) {
      const [kk, vv] = k.split("=");
      argv[kk] = vv;
    } else if (i + 1 < a.length && !a[i + 1].startsWith("--")) {
      argv[k] = a[++i];
    } else {
      argv[k] = true;
    }
  }
}

async function main() {
  const chainId = Number(argv.chain ?? 1);
  if (argv.hash) {
    const rpc = new Rpc(chainId);
    const tx = await rpc.call<{ from: Address; to: Address | null; value: Hex; input: Hex } | null>(
      "eth_getTransactionByHash", [argv.hash as string]);
    if (!tx) { console.error("tx not found"); process.exit(1); }
    const res = await scanTx(chainId, {
      from: getAddress(tx.from),
      to: getAddress(tx.to ?? "0x0000000000000000000000000000000000000000"),
      value: BigInt(tx.value),
      data: tx.input,
    });
    console.log(JSON.stringify(res, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2));
    return;
  }
  if (argv.to) {
    const res = await scanTx(chainId, {
      from: getAddress((argv.from as string) ?? "0x0000000000000000000000000000000000000001"),
      to: getAddress(argv.to as string),
      value: BigInt(String(argv.value ?? 0)),
      data: (argv.data as Hex) ?? ("0x" as Hex),
    });
    console.log(JSON.stringify(res, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2));
    return;
  }
  console.error("usage: cli.ts --hash 0x.. [--chain 1] | --to 0x.. [--data 0x..] [--from 0x..] [--value 0]");
  process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
