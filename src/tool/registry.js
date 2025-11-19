// Import OpenCode tools directly (Bun supports TypeScript natively)
import { BashTool } from "./bash.ts"
import { ReadTool } from "./read.ts"
import { WriteTool } from "./write.ts"
import { EditTool } from "./edit.ts"
import { GlobTool } from "./glob.ts"
import { GrepTool } from "./grep.ts"
import { ListTool } from "./ls.ts"
import { TaskTool } from "./task.ts"
import { TodoWriteTool, TodoReadTool } from "./todo.ts"
import { WebFetchTool } from "./webfetch.ts"

class ToolRegistry {
  static async getTools() {
    // Return all OpenCode tools
    const tools = [
      BashTool,
      ReadTool,
      WriteTool,
      EditTool,
      GlobTool,
      GrepTool,
      ListTool,
      TaskTool,
      TodoWriteTool,
      TodoReadTool,
      WebFetchTool,
    ]

    // Initialize all tools
    const result = {}
    for (const tool of tools) {
      const info = await tool.init()
      result[tool.id] = info
    }

    return result
  }
}

export { ToolRegistry }
