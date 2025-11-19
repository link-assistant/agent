// Mock MessageV2 for MVP
export namespace MessageV2 {
  export interface FilePart {
    type: "file"
    path: string
    content: string
  }

  export interface Info {
    id: string
    sessionID: string
  }

  export function create(options: any): Info {
    return {
      id: `msg_${Math.random().toString(36).substr(2, 9)}`,
      sessionID: options.sessionID
    }
  }
}

export { MessageV2 as default }
