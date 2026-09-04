import { decodeCall } from "../src/decode.js";
const data = "0xa22cb465" + "0".repeat(24) + "63c79fccd0a21e4a4d87056a0efe3b85d8c373d4" + "0".repeat(63) + "1";
console.log("len", data.length);
console.log(JSON.stringify(decodeCall(data as `0x${string}`), (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2));
