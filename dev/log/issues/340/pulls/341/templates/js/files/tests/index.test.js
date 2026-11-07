/**
 * Example test file using test-anywhere
 * Works with Node.js, Bun, and Deno
 */

import { describe, it, expect } from 'test-anywhere';
import { add, multiply } from '../src/index.js';

describe('add function', () => {
  it('should add two positive numbers', () => {
    expect(add(2, 3)).toBe(5);
  });

  it('should add negative numbers', () => {
    expect(add(-1, -2)).toBe(-3);
  });

  it('should add zero', () => {
    expect(add(5, 0)).toBe(5);
  });
});

describe('multiply function', () => {
  it('should multiply two positive numbers', () => {
    expect(multiply(2, 3)).toBe(6);
  });

  it('should multiply by zero', () => {
    expect(multiply(5, 0)).toBe(0);
  });

  it('should multiply negative numbers', () => {
    expect(multiply(-2, 3)).toBe(-6);
  });
});
