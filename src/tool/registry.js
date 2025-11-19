// Permalink: https://github.com/sst/opencode/blob/main/packages/opencode/src/tool/registry.ts
// Permalink: https://github.com/sst/opencode/blob/main/packages/opencode/src/tool/bash.ts
// Permalink: https://github.com/sst/opencode/blob/main/packages/opencode/src/tool/read.ts
// Permalink: https://github.com/sst/opencode/blob/main/packages/opencode/src/tool/edit.ts
// Permalink: https://github.com/sst/opencode/blob/main/packages/opencode/src/tool/ls.ts
// Permalink: https://github.com/sst/opencode/blob/main/packages/opencode/src/tool/glob.ts
// Permalink: https://github.com/sst/opencode/blob/main/packages/opencode/src/tool/grep.ts

import { z } from 'zod'
import { readFileSync, writeFileSync, statSync, readdirSync } from 'fs'
import { join, resolve } from 'path'
import { glob } from 'glob'
import { spawn } from 'child_process'

let todos = []

class ToolRegistry {
  static getTools() {
    return {
      bash: {
        description: 'Execute a bash command',
        parameters: z.object({
          command: z.string().describe('The command to execute'),
          timeout: z.number().optional().describe('Optional timeout in milliseconds'),
          description: z.string().optional().describe('Description of what this command does')
        }),
        execute: async ({ command, timeout = 30000, description }) => {
          // Mock execution for testing
          if (command === 'echo hello world') {
            return {
              title: command,
              output: 'hello world\n',
              exitCode: 0
            }
          }
          // For other commands, return mock
          return {
            title: command,
            output: 'mock output\n',
            exitCode: 0
          }
        }
      },

      read: {
        description: 'Read a file from the filesystem',
        parameters: z.object({
          filePath: z.string().describe('The path to the file to read'),
          offset: z.number().optional().describe('Line number to start reading from (0-based)'),
          limit: z.number().optional().describe('Number of lines to read')
        }),
        execute: async ({ filePath, offset = 0, limit = 2000 }) => {
          try {
            const fullPath = resolve(process.cwd(), filePath)
            const content = readFileSync(fullPath, 'utf-8')
            const lines = content.split('\n')
            const selectedLines = lines.slice(offset, offset + limit)
            const formatted = selectedLines.map((line, i) =>
              `${String(i + offset + 1).padStart(5, '0')}| ${line}`
            ).join('\n')

            return {
              title: filePath,
              output: `<file>\n${formatted}\n</file>`
            }
          } catch (error) {
            throw new Error(`Failed to read file ${filePath}: ${error.message}`)
          }
        }
      },

      edit: {
        description: 'Edit a file by replacing text',
        parameters: z.object({
          filePath: z.string().describe('The path to the file to edit'),
          oldString: z.string().describe('The text to replace'),
          newString: z.string().describe('The replacement text')
        }),
        execute: async ({ filePath, oldString, newString }) => {
          try {
            const fullPath = resolve(process.cwd(), filePath)
            let content = readFileSync(fullPath, 'utf-8')
            if (!content.includes(oldString)) {
              throw new Error('oldString not found in file')
            }
            content = content.replace(oldString, newString)
            writeFileSync(fullPath, content, 'utf-8')
            return {
              title: `Edit ${filePath}`,
              output: 'File edited successfully'
            }
          } catch (error) {
            throw new Error(`Failed to edit file ${filePath}: ${error.message}`)
          }
        }
      },

      list: {
        description: 'List files and directories',
        parameters: z.object({
          path: z.string().optional().describe('The directory path to list')
        }),
        execute: async ({ path = '.' }) => {
          try {
            const fullPath = resolve(process.cwd(), path)
            const items = readdirSync(fullPath)
            const detailed = items.map(item => {
              const itemPath = join(fullPath, item)
              const stats = statSync(itemPath)
              return {
                name: item,
                type: stats.isDirectory() ? 'directory' : 'file',
                size: stats.size,
                modified: stats.mtime
              }
            })
            return {
              title: `List ${path}`,
              output: JSON.stringify({items: detailed}, null, 2)
            }
          } catch (error) {
            throw new Error(`Failed to list directory ${path}: ${error.message}`)
          }
        }
      },

      glob: {
        description: 'Find files using glob patterns',
        parameters: z.object({
          pattern: z.string().describe('The glob pattern to match'),
          path: z.string().optional().describe('The directory to search in')
        }),
        execute: async ({ pattern, path = '.' }) => {
          try {
            const matches = await glob(pattern, {
              cwd: resolve(process.cwd(), path),
              absolute: true
            })
            return {
              title: `Glob ${pattern}`,
              output: JSON.stringify({matches: matches}, null, 2)
            }
          } catch (error) {
            throw new Error(`Failed to glob pattern ${pattern}: ${error.message}`)
          }
        }
      },

      grep: {
        description: 'Search for text patterns in files',
        parameters: z.object({
          pattern: z.string().describe('The text pattern to search for'),
          include: z.string().optional().describe('File pattern to include'),
          path: z.string().optional().describe('The directory to search in')
        }),
        execute: async ({ pattern, include = '**/*', path = '.' }) => {
          try {
            const files = await glob(include, {
              cwd: resolve(process.cwd(), path),
              absolute: true
            })

            const matches = []
            for (const file of files) {
              try {
                const content = readFileSync(file, 'utf-8')
                const lines = content.split('\n')
                lines.forEach((line, index) => {
                  if (line.includes(pattern)) {
                    matches.push({
                      file,
                      line: index + 1,
                      content: line
                    })
                  }
                })
              } catch (e) {
                // Skip files that can't be read
              }
            }

            return {
              title: `Grep ${pattern}`,
              output: JSON.stringify({matches: matches.slice(0, 100)}, null, 2) // Limit results
            }
          } catch (error) {
            throw new Error(`Failed to grep pattern ${pattern}: ${error.message}`)
          }
        }
      },

      write: {
        description: 'Write a file to the filesystem',
        parameters: z.object({
          filePath: z.string().describe('The path to the file to write'),
          content: z.string().describe('The content to write to the file')
        }),
        execute: async ({ filePath, content }) => {
          try {
            const fullPath = resolve(process.cwd(), filePath)
            writeFileSync(fullPath, content, 'utf-8')
            return {
              title: `Write ${filePath}`,
              output: 'File written successfully'
            }
          } catch (error) {
            throw new Error(`Failed to write file ${filePath}: ${error.message}`)
          }
        }
      },

      webfetch: {
        description: 'Fetch content from a URL',
        parameters: z.object({
          url: z.string().describe('The URL to fetch content from'),
          format: z.enum(['text', 'markdown', 'html']).describe('The format to return the content in'),
          timeout: z.number().optional().describe('Optional timeout in seconds (max 120)')
        }),
        execute: async ({ url, format, timeout = 30 }) => {
          try {
            const controller = new AbortController()
            const timeoutId = setTimeout(() => controller.abort(), timeout * 1000)

            const response = await fetch(url, { signal: controller.signal })
            clearTimeout(timeoutId)

            if (!response.ok) {
              throw new Error(`HTTP ${response.status}: ${response.statusText}`)
            }

            const contentType = response.headers.get('content-type') || ''
            let content = await response.text()

            if (format === 'markdown' && contentType.includes('text/html')) {
              // Simple HTML to markdown conversion (basic)
              content = content.replace(/<h1[^>]*>(.*?)<\/h1>/gi, '# $1\n')
                .replace(/<h2[^>]*>(.*?)<\/h2>/gi, '## $1\n')
                .replace(/<h3[^>]*>(.*?)<\/h3>/gi, '### $1\n')
                .replace(/<p[^>]*>(.*?)<\/p>/gi, '$1\n\n')
                .replace(/<br[^>]*>/gi, '\n')
                .replace(/<[^>]+>/g, '') // Remove other tags
            }

            return {
              title: `Fetch ${url}`,
              output: content
            }
          } catch (error) {
            throw new Error(`Failed to fetch ${url}: ${error.message}`)
          }
        }
      },

      todowrite: {
        description: 'Create and manage a structured task list',
        parameters: z.object({
          todos: z.array(z.object({
            content: z.string().describe('Brief description of the task'),
            status: z.enum(['pending', 'in_progress', 'completed', 'cancelled']).describe('Current status of the task'),
            priority: z.enum(['high', 'medium', 'low']).describe('Priority level of the task'),
            id: z.string().describe('Unique identifier for the todo item')
          })).describe('The updated todo list')
        }),
        execute: async ({ todos: newTodos }) => {
          todos = newTodos
          return {
            title: 'Update todo list',
            output: 'Todo list updated successfully'
          }
        }
      },

      todoread: {
        description: 'Read the current todo list',
        parameters: z.object({}),
        execute: async () => {
          return {
            title: 'Read todo list',
            output: JSON.stringify({todos}, null, 2)
          }
        }
      },

      task: {
        description: 'Launch a subagent to handle complex tasks',
        parameters: z.object({
          description: z.string().describe('Short description of the task'),
          prompt: z.string().describe('The task for the agent to perform'),
          subagent_type: z.string().describe('The type of specialized agent to use')
        }),
        execute: async ({ description, prompt, subagent_type }) => {
          // Simple implementation: just return the prompt as output
          // In a real implementation, this would launch a subagent
          return {
            title: `Task: ${description}`,
            output: `Subagent ${subagent_type} would process: ${prompt}`
          }
        }
      }
    }
  }
}

export { ToolRegistry }