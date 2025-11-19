// Mock Permission for MVP
export namespace Permission {
  export async function ask(options: any): Promise<void> {
    // For MVP, always grant permission
  }

  export class RejectedError extends Error {
    constructor(sessionID: string, type: string, callID: string, metadata: any, message: string) {
      super(message)
      this.name = 'RejectedError'
    }
  }
}
