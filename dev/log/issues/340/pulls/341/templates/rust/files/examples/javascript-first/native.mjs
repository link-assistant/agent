// Independent native implementation. Integers outside the signed 32-bit domain
// and overflow are refused rather than silently rounded or wrapped.
export function add(a, b) {
  if (![a, b].every(x => Number.isInteger(x) && x >= -2147483648 && x <= 2147483647)) {
    throw new RangeError('invalid i32');
  }
  const result = a + b;
  if (result < -2147483648 || result > 2147483647) throw new RangeError('overflow');
  return result;
}
