// Test: Verify ESM live bindings work with Flag.VERBOSE
import { Flag } from '../js/src/flag/flag.ts';

console.log("Initial VERBOSE:", Flag.VERBOSE);

Flag.setVerbose(true);
console.log("After setVerbose(true):", Flag.VERBOSE);

Flag.setVerbose(false);
console.log("After setVerbose(false):", Flag.VERBOSE);

// Test the exact pattern used in provider.ts
const check = () => {
  if (!Flag.VERBOSE) {
    console.log("  -> Would SKIP verbose logging");
  } else {
    console.log("  -> Would DO verbose logging");
  }
};

console.log("\nWith verbose=false:");
Flag.setVerbose(false);
check();

console.log("With verbose=true:");
Flag.setVerbose(true);
check();
