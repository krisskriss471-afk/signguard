import { refreshBlocklists } from "../src/blocklists.js";
import { KNOWN_DRAINERS } from "../src/rules.js";
refreshBlocklists().then((n) => {
  console.log("added", n, "total", KNOWN_DRAINERS.size);
  process.exit(0);
});
