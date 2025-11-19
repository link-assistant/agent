// Mock lazy for MVP
export function lazy<T>(fn: () => Promise<T>): () => Promise<T> {
  let cached: T | undefined
  let promise: Promise<T> | undefined
  return () => {
    if (cached) return Promise.resolve(cached)
    if (promise) return promise
    promise = fn().then(result => {
      cached = result
      promise = undefined
      return result
    })
    return promise
  }
}
