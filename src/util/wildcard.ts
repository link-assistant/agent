// Mock Wildcard for MVP
export namespace Wildcard {
  export function allStructured(command: { head: string; tail: string[] }, permissions: any): "allow" | "deny" | "ask" {
    // For MVP, always allow
    return "allow"
  }
}
