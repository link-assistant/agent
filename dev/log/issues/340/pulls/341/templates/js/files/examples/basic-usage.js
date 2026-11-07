/**
 * Basic usage example
 * Demonstrates how to use the package
 *
 * Run with any runtime:
 * - Bun: bun examples/basic-usage.js
 * - Node.js: node examples/basic-usage.js
 * - Deno: deno run examples/basic-usage.js
 */

import { add, multiply, delay } from '../src/index.js';

// Example: Using add function
console.log('Addition examples:');
console.log(`  2 + 3 = ${add(2, 3)}`);
console.log(`  -1 + 5 = ${add(-1, 5)}`);

// Example: Using multiply function
console.log('\nMultiplication examples:');
console.log(`  4 * 5 = ${multiply(4, 5)}`);
console.log(`  -2 * 3 = ${multiply(-2, 3)}`);

// Example: Using async delay function
console.log('\nAsync example:');
console.log('  Waiting 100ms...');
await delay(100);
console.log('  Done!');
