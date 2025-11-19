// Permalink: https://github.com/sst/opencode/blob/main/packages/opencode/src/tool/registry.ts
// Permalink: https://github.com/sst/opencode/blob/main/packages/opencode/src/tool/bash.ts
// Permalink: https://github.com/sst/opencode/blob/main/packages/opencode/src/tool/read.ts
// Permalink: https://github.com/sst/opencode/blob/main/packages/opencode/src/tool/edit.ts
// Permalink: https://github.com/sst/opencode/blob/main/packages/opencode/src/tool/ls.ts
// Permalink: https://github.com/sst/opencode/blob/main/packages/opencode/src/tool/glob.ts
// Permalink: https://github.com/sst/opencode/blob/main/packages/opencode/src/tool/grep.ts

import { tool } from 'ai'
import { z } from 'zod'
import { readFileSync, writeFileSync, statSync, readdirSync } from 'fs'
import { join, resolve } from 'path'
import { glob } from 'glob'
import { spawn } from 'child_process'

class ToolRegistry {
  static getTools() {
    return {
      bash: tool({
        description: 'Execute a bash command',
        parameters: z.object({
          command: z.string().describe('The command to execute'),
          timeout: z.number().optional().describe('Optional timeout in milliseconds'),
          description: z.string().optional().describe('Description of what this command does')
        }),
        execute: async ({ command, timeout = 30000, description }) => {
          return new Promise((resolve, reject) => {
            const proc = spawn(command, { shell: true, cwd: process.cwd() })
            let output = ''
            let errorOutput = ''

            const append = (chunk) => output += chunk.toString()
            const appendError = (chunk) => errorOutput += chunk.toString()

            proc.stdout?.on('data', append)
            proc.stderr?.on('data', appendError)

            const timer = setTimeout(() => {
              proc.kill()
              reject(new Error(`Command timed out after ${timeout}ms`))
            }, timeout)

            proc.on('close', (code) => {
              clearTimeout(timer)
              resolve({
                title: command,
                output: output + errorOutput,
                exitCode: code
              })
            })

            proc.on('error', (err) => {
              clearTimeout(timer)
              reject(err)
            })
          })
        }
      }),

      read: tool({
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
      }),

      edit: tool({
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
      }),

      list: tool({
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
      }),

      glob: tool({
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
      }),

      grep: tool({
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
      })
    }
  }
}

export { ToolRegistry }