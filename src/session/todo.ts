import z from "zod"

// Mock Todo for MVP
export namespace Todo {
  export const Info = z.object({
    content: z.string(),
    status: z.enum(["pending", "in_progress", "completed", "cancelled"]),
    activeForm: z.string().optional(),
  })

  export type Info = z.infer<typeof Info>

  let todos: Info[] = []

  export async function update(options: { sessionID: string; todos: Info[] }): Promise<void> {
    todos = options.todos
  }

  export async function get(sessionID: string): Promise<Info[]> {
    return todos
  }
}
