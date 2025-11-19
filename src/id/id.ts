// Mock Identifier for MVP
export namespace Identifier {
  export function generate(prefix: string): string {
    return `${prefix}_${Math.random().toString(36).substr(2, 9)}`
  }
}
