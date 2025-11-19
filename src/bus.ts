// Mock Bus for MVP
export namespace Bus {
  export async function publish(event: string, data: any): Promise<void> {
    // No-op for MVP
  }
}
