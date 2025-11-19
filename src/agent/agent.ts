// Mock Agent for MVP
export namespace Agent {
  export interface Info {
    mode?: string
    permission: {
      bash: Record<string, "allow" | "deny" | "ask">
      edit: "allow" | "deny" | "ask"
      external_directory: "allow" | "deny" | "ask"
      webfetch: "allow" | "deny" | "ask"
    }
  }

  export async function get(agentID: string): Promise<Info> {
    return {
      mode: "primary",
      permission: {
        bash: { "*": "allow" },
        edit: "allow",
        external_directory: "allow",
        webfetch: "allow"
      }
    }
  }

  export async function list(): Promise<Info[]> {
    // For MVP, return empty list (no additional agents)
    return []
  }
}
