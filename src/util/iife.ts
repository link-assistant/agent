// Mock iife for MVP - supports both sync and async functions
export function iife<T>(fn: () => T): T {
  return fn()
}

// For async version
export async function iifeAsync<T>(fn: () => Promise<T>): Promise<T> {
  return fn()
}
