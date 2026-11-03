// Prints the project detected for a directory. Run in a child process so an
// unhandled rejection makes it exit non-zero (issue #335).
import { Project } from '../../src/project/project';

const project = await Project.fromDirectory(process.argv[2]!);
// Let any stray background promise settle before reporting success.
await new Promise((resolve) => setTimeout(resolve, 200));
console.log(JSON.stringify({ id: project.id, worktree: project.worktree }));
