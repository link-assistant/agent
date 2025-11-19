// Mock Provider for MVP
export namespace Provider {
  export interface ImageSupport {
    supported: boolean
  }

  export function imageSupport(providerID: string, modelID: string): ImageSupport {
    return { supported: false }
  }
}
