// Permalink: https://github.com/sst/opencode/blob/main/packages/opencode/src/session/prompt.ts
// Permalink: https://github.com/sst/opencode/blob/main/packages/opencode/src/session/index.ts
// Permalink: https://github.com/sst/opencode/blob/main/packages/opencode/src/provider/provider.ts

import { ToolRegistry } from '../tool/registry.js'

export class Agent {
  constructor() {
    // Generate IDs in the same format as opencode
    const randomId = Math.random().toString(36).substring(2, 15)
    this.sessionID = `ses_${Date.now().toString(36)}${randomId}`
    this.messageID = `msg_${Date.now().toString(36)}${randomId}`
    this.partCounter = 0
  }

  generatePartId() {
    return `prt_${Date.now().toString(36)}${Math.random().toString(36).substring(2, 15)}`
  }

  async process(request) {
    const message = request.message || "hi"
    const sessionID = this.sessionID

    // Generate snapshot hash (mock)
    const snapshot = Math.random().toString(16).substring(2, 42)

    // Emit step_start like opencode
    this.emitEvent('step_start', {
      part: {
        id: this.generatePartId(),
        sessionID,
        messageID: this.messageID,
        type: 'step-start',
        snapshot
      }
    })

    // Check if this is a tool request
    if (request.tools && request.tools.length > 0) {
      // Handle tool execution
      const tools = await ToolRegistry.getTools()
      for (const tool of request.tools) {
        const toolFn = tools[tool.name]
        if (toolFn) {
          try {
            const startTime = Date.now()
            const callID = `call_${Math.floor(Math.random() * 100000000)}`

            // Create OpenCode-compatible context
            const ctx = {
              sessionID,
              messageID: this.messageID,
              agent: 'default',
              callID,
              abort: new AbortController().signal,
              metadata: (data) => {
                // Handle metadata updates during execution
              }
            }

            const result = await toolFn.execute(tool.params, ctx)
            const endTime = Date.now()

            // Emit tool_use event
            this.emitEvent('tool_use', {
              part: {
                id: this.generatePartId(),
                sessionID,
                messageID: this.messageID,
                type: 'tool',
                callID,
                tool: tool.name,
                state: {
                  status: 'completed',
                  input: tool.params,
                  output: result.output,
                  title: result.title || `${tool.name} ${JSON.stringify(tool.params)}`,
                  metadata: result.metadata || {
                    output: result.output,
                    exit: result.exitCode || 0,
                    ...(tool.params.description && { description: tool.params.description })
                  },
                  time: {
                    start: startTime,
                    end: endTime
                  }
                }
              }
            })
          } catch (error) {
            const errorTime = Date.now()
            const callID = `call_${Math.floor(Math.random() * 100000000)}`

            // Emit tool_use event with error
            this.emitEvent('tool_use', {
              part: {
                id: this.generatePartId(),
                sessionID,
                messageID: this.messageID,
                type: 'tool',
                callID,
                tool: tool.name,
                state: {
                  status: 'error',
                  input: tool.params,
                  error: error.message,
                  time: {
                    start: errorTime,
                    end: errorTime
                  }
                }
              }
            })
          }
        }
      }

      // Emit step_finish for tool requests
      this.emitEvent('step_finish', {
        part: {
          id: this.generatePartId(),
          sessionID,
          messageID: this.messageID,
          type: 'step-finish',
          reason: 'stop',
          snapshot,
          cost: 0,
          tokens: {
            input: 1273,
            output: 2,
            reasoning: 173,
            cache: { read: 9536, write: 0 }
          }
        }
      })

      return {
        sessionID,
        timestamp: Date.now()
      }
    }

    // Regular message processing
    // Simulate processing delay
    await new Promise(resolve => setTimeout(resolve, 100))

    // Emit text response like opencode
    const responseText = message === "hi" ? "Hi!" : `You said: "${message}"`
    this.emitEvent('text', {
      part: {
        id: this.generatePartId(),
        sessionID,
        messageID: this.messageID,
        type: 'text',
        text: responseText,
        time: {
          start: Date.now(),
          end: Date.now()
        }
      }
    })

    // Emit step_finish with cost and tokens like opencode
    this.emitEvent('step_finish', {
      part: {
        id: this.generatePartId(),
        sessionID,
        messageID: this.messageID,
        type: 'step-finish',
        reason: 'stop',
        snapshot,
        cost: 0,
        tokens: {
          input: 1273,
          output: 2,
          reasoning: 173,
          cache: { read: 9536, write: 0 }
        }
      }
    })

    return {
      sessionID,
      timestamp: Date.now()
    }
  }

  emitEvent(type, data) {
    const event = {
      type,
      timestamp: Date.now(),
      sessionID: this.sessionID,
      ...data
    }
    console.log(JSON.stringify(event))
  }
}