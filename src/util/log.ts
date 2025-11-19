// Mock Log for MVP
export namespace Log {
  export function create(options: { service: string }) {
    return {
      info: (...args: any[]) => {},
      error: (...args: any[]) => {},
      warn: (...args: any[]) => {},
      debug: (...args: any[]) => {},
    }
  }
}
