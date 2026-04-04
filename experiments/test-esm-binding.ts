// Test: Verify ESM live bindings work with config.verbose
import { config, setVerbose } from "../js/src/config/agent-config.ts";

console.log("Initial VERBOSE:", config.verbose);

setVerbose(true);
console.log("After setVerbose(true):", config.verbose);

setVerbose(false);
console.log("After setVerbose(false):", config.verbose);

// Test the exact pattern used in provider.ts
const check = () => {
  if (!config.verbose) {
    console.log("  -> Would SKIP verbose logging");
  } else {
    console.log("  -> Would DO verbose logging");
  }
};

console.log("\nWith verbose=false:");
setVerbose(false);
check();

console.log("With verbose=true:");
setVerbose(true);
check();
