// Mock Instance for MVP
export namespace Instance {
  export const directory = process.cwd()
  export const worktree = process.cwd()

  export function state<T>(fn: () => Promise<T>): () => Promise<T> {
    let cached: T | undefined
    return async () => {
      if (!cached) cached = await fn()
      return cached
    }
  }
}
