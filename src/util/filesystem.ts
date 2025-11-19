import path from "path"

// Mock Filesystem for MVP
export namespace Filesystem {
  export function contains(parent: string, child: string): boolean {
    const rel = path.relative(parent, child)
    return !rel.startsWith('..') && !path.isAbsolute(rel)
  }
}
