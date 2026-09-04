import { Rpc } from "../src/rpc.js";
(async () => {
  for (const url of ["https://ethereum-rpc.publicnode.com", "https://eth.drpc.org", "https://rpc.flashbots.net"]) {
    const rpc = new Rpc(1, [url]);
    const head = BigInt(await rpc.getBlockNumber());
    for (const span of [500n, 100n]) {
      try {
        const logs = await rpc.call<unknown[]>("eth_getLogs", [{
          fromBlock: "0x" + (head - span).toString(16),
          toBlock: "0x" + head.toString(16),
          address: "0xdac17f958d2ee523a2206206994597c13d831ec7",
          topics: ["0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925"],
        }]);
        console.log(url, span, Array.isArray(logs) ? logs.length : JSON.stringify(logs).slice(0, 60));
      } catch (e) {
        console.log(url, span, "ERR", String(e).slice(0, 70));
      }
    }
  }
})();
