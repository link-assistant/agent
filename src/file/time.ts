// Mock FileTime for MVP
export namespace FileTime {
  export async function assert(sessionID: string, filepath: string): Promise<void> {
    // No-op for MVP - always allow
    return
  }

  export async function read(sessionID: string, filepath: string): Promise<void> {
    // No-op for MVP
  }

  export function check(sessionID: string, filepath: string): boolean {
    // For MVP always return true (file hasn't changed)
    return true
  }
}
