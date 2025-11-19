// Mock LSP for MVP
export namespace LSP {
  export async function touchFile(filepath: string, create: boolean): Promise<void> {
    // No-op for MVP
  }

  export async function diagnostics(): Promise<Record<string, any[]>> {
    // No diagnostics for MVP
    return {}
  }

  export namespace Diagnostic {
    export function pretty(diagnostic: any): string {
      return ""
    }
  }
}
