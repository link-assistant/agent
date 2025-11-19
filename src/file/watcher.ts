// Mock FileWatcher for MVP
export namespace FileWatcher {
  export async function watch(filepath: string, callback: () => void): Promise<void> {
    // No-op for MVP
  }
}
