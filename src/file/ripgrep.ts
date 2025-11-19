import { glob as bunGlob } from "glob"

// Mock Ripgrep for MVP - use glob instead
export namespace Ripgrep {
  export async function* files(options: { cwd: string; glob: string[] }): AsyncGenerator<string> {
    // Separate patterns into include and ignore
    const includePatterns: string[] = []
    const ignorePatterns: string[] = []

    for (const pattern of options.glob) {
      if (pattern.startsWith('!')) {
        // Remove the ! prefix for ignore patterns
        ignorePatterns.push(pattern.substring(1))
      } else {
        includePatterns.push(pattern)
      }
    }

    // If no include patterns, default to all files
    const patterns = includePatterns.length > 0 ? includePatterns : ['**/*']

    for (const pattern of patterns) {
      const matches = await bunGlob(pattern, {
        cwd: options.cwd,
        absolute: false,
        ignore: ignorePatterns,
        nodir: false, // Include directories
      })
      for (const match of matches) {
        yield match
      }
    }
  }

  // Return path to ripgrep binary
  export async function filepath(): Promise<string> {
    // Check common locations for rg
    const commonPaths = [
      "/usr/local/bin/rg",
      "/usr/bin/rg",
      "/opt/homebrew/bin/rg",
      `${process.env.HOME}/.bun/install/global/node_modules/@anthropic-ai/claude-code/vendor/ripgrep/arm64-darwin/rg`,
      `${process.env.HOME}/.bun/install/global/node_modules/@anthropic-ai/claude-code/vendor/ripgrep/x64-darwin/rg`,
      `${process.env.HOME}/.bun/install/global/node_modules/@anthropic-ai/claude-code/vendor/ripgrep/x64-linux/rg`,
      `${process.env.HOME}/.bun/install/global/node_modules/@anthropic-ai/claude-code/vendor/ripgrep/arm64-linux/rg`,
    ]

    for (const rgPath of commonPaths) {
      try {
        const file = Bun.file(rgPath)
        if (await file.exists()) {
          return rgPath
        }
      } catch (e) {
        // Continue to next path
      }
    }

    // Fallback to just "rg" and hope it's in PATH
    return "rg"
  }
}
