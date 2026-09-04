import { Rpc } from "../src/rpc.js";
const rpc = new Rpc(1);
rpc
  .call("eth_getTransactionByHash", ["0xd838ca5a4ef6dd9591d0e1d891410ef877290fb8391b5c293fe0ecf556fac40d"])
  .then((r) => console.log("RESULT", r ? "ok" : "null"))
  .catch((e) => console.log("ERR", String(e).slice(0, 300)));
