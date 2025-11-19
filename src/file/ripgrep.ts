import { glob as bunGlob } from "glob"

// Mock Ripgrep for MVP - use glob instead
export namespace Ripgrep {
  export async function* files(options: { cwd: string; glob: string[] }): AsyncGenerator<string> {
    for (const pattern of options.glob) {
      const matches = await bunGlob(pattern, {
        cwd: options.cwd,
        absolute: false
      })
      for (const match of matches) {
        yield match
      }
    }
  }
}
