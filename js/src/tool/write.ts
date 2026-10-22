import z from 'zod';
import * as path from 'path';
import { Tool } from './tool';
import DESCRIPTION from './write.txt';
import { Instance } from '../project/instance';
import { Permission } from '../permission';
import { FileTime } from '../file/time';
import { Bus } from '../bus';
import { File } from '../file';
import { Bom } from '../util/bom';

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
    const filepath = path.isAbsolute(params.filePath)
      ? params.filePath
      : path.join(Instance.directory, params.filePath);

    // Permission enforcement (issue #271). Writing is governed by the same
    // `edit` policy as the edit tool: `auto` allows, plan/readonly deny,
    // `ask` emits a JSON permission request.
    await Permission.check({
      type: 'edit',
      title: filepath,
      sessionID: ctx.sessionID,
      messageID: ctx.messageID,
      callID: ctx.callID,
      metadata: { filePath: filepath },
    });

    // Serialize with concurrent edit/write calls on the same file.
    const exists = await FileTime.withLock(filepath, async () => {
      // No read-before-write requirement here on purpose: this fork lets
      // the write tool overwrite files without a prior read.
      const file = Bun.file(filepath);
      const exists = await file.exists();
      // Keep an existing UTF-8 BOM (Bun.file().text() would hide it).
      const bom = exists && (await Bom.has(filepath));
      const next = Bom.split(params.content);
      await Bun.write(filepath, Bom.join(next.text, bom || next.bom));
      await Bus.publish(File.Event.Edited, { file: filepath });
      // Record the write as a read so a follow-up edit does not fail with
      // "You must read the file ... before overwriting it".
      FileTime.read(ctx.sessionID, filepath);
      return exists;
    });

    return {
      title: path.relative(Instance.worktree, filepath),
      metadata: {
        diagnostics: {},
        filepath,
        exists: exists,
      },
      output: 'Wrote file successfully.',
    };
  },
});
