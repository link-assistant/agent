#!/usr/bin/env bun
/**
 * Test if TypeScript namespace export let creates a live binding
 */

// Simulate the Flag namespace
export namespace TestFlag {
  export let value = false;
  export function setValue(v: boolean) {
    value = v;
  }
}

// Import and test
console.log('Before setValue:', TestFlag.value);
TestFlag.setValue(true);
console.log('After setValue:', TestFlag.value);

// Simulate what verbose-fetch does
function checkFlag() {
  return TestFlag.value;
}

console.log('checkFlag():', checkFlag());
