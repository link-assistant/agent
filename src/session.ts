import z from "zod"

// Mock Session for MVP
export namespace Session {
  export const Info = z.object({
    id: z.string(),
    agent: z.string(),
  })

  export type Info = z.infer<typeof Info>

  export interface Options {
    sessionID: string
    providerID: string
    modelID: string
    agent: string
  }

  export async function fork(options: Options): Promise<string> {
    return `ses_${Math.random().toString(36).substr(2, 9)}`
  }

  export async function get(sessionID: string): Promise<Info> {
    return {
      id: sessionID,
      agent: "default"
    }
  }
}
