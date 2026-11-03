// Reproduces the unhandled ENOTDIR rejection in Project.fromDirectory when
// `.git` is a file (git worktree / submodule). Usage:
//   bun experiments/issue-335/project-worktree.ts <directory>
import { Project } from '../../js/src/project/project';

const project = await Project.fromDirectory(process.argv[2]);
// Give the (formerly un-awaited) cache write time to settle.
await new Promise((r) => setTimeout(r, 200));
console.log(JSON.stringify({ id: project.id, worktree: project.worktree }));
