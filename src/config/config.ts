// Mock Config for MVP
export namespace Config {
  export interface Info {
    experimental?: {
      batch_tool?: boolean
    }
  }

  export async function get(): Promise<Info> {
    return {}
  }

  export async function directories(): Promise<string[]> {
    return []
  }
}
