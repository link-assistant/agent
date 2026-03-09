// Test: Verify log-lazy behavior with lazy evaluation
import makeLog, { levels } from 'log-lazy';

console.log("=== Test 1: Initial disabled state ===");
let lazyLogInstance = makeLog({ level: 0 }); // Start disabled

const sideEffectLog = [];
function testLazy(label) {
  lazyLogInstance.info(() => {
    sideEffectLog.push(`${label}: side effect executed`);
    console.log(`${label}: SIDE EFFECT EXECUTED`);
    return '';
  });
}

testLazy('BEFORE_INIT');
console.log("Side effects after disabled call:", sideEffectLog);

console.log("\n=== Test 2: After enabling levels ===");
lazyLogInstance = makeLog({
  level: levels.debug | levels.info | levels.warn | levels.error,
});

testLazy('AFTER_INIT');
console.log("Side effects after enabled call:", sideEffectLog);

console.log("\n=== Test 3: Verify output goes to console.log ===");
lazyLogInstance.info(() => {
  return 'This should appear via console.log';
});

console.log("\n=== Test 4: Multiple arguments ===");
lazyLogInstance.info('direct string', 'second arg');

console.log("\n=== Test 5: Function that returns object ===");
lazyLogInstance.info(() => {
  return { test: true, message: 'object result' };
});
