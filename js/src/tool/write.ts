import z from 'zod';
import * as path from 'path';
import { Tool } from './tool';
import DESCRIPTION from './write.txt';
import { Instance } from '../project/instance';

export const WriteTool = Tool.define('write', {
  description: DESCRIPTION,
  parameters: z.object({
    content: z.string().describe('The content to write to the file'),
    filePath: z
      .string()
      .describe(
        'The absolute path to the file to write (must be absolute, not relative)'
      ),
  }),
  async execute(params, ctx) {
    // No restrictions - unrestricted file system access
    const filepath = path.isAbsolute(params.filePath)
      ? params.filePath
      : path.join(Instance.directory, params.filePath);

    const file = Bun.file(filepath);
    const exists = await file.exists();

    // Write the file without permission checks
    await Bun.write(filepath, params.content);

    return {
      title: path.relative(Instance.worktree, filepath),
      metadata: {
        diagnostics: {},
        filepath,
        exists: exists,
      },
      output: '',
    };
  },
});
