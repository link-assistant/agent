export function isEven(value) {
  if (!Number.isInteger(value) || value < -2147483648 || value > 2147483647) {
    throw new RangeError('Expected a signed 32-bit integer');
  }
  return value % 2 === 0;
}
