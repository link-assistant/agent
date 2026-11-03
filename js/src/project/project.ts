import z from 'zod';
import { Filesystem } from '../util/filesystem';
import path from 'path';
import { $ } from 'bun';
import { Storage } from '../storage/storage';
import { Log } from '../util/log';
import fs from 'node:fs/promises';
import { Global } from '../global';

export namespace Project {
  const log = Log.create({ service: 'project' });
  const recentSnapshotAge = 15 * 60_000;
  export const Info = z
    .object({
      id: z.string(),
      worktree: z.string(),
      vcs: z.literal('git').optional(),
      time: z.object({
        created: z.number(),
        initialized: z.number().optional(),
      }),
    })
    .meta({
      ref: 'Project',
    });
  export type Info = z.infer<typeof Info>;

  export async function fromDirectory(directory: string) {
    log.info(() => ({ message: 'fromDirectory', directory }));
    await prune();
    const matches = Filesystem.up({ targets: ['.git'], start: directory });
    const git = await matches.next().then((x) => x.value);
    await matches.return();
    if (!git) {
      const project: Info = {
        id: 'global',
        worktree: '/',
        vcs: 'none', // No VCS
        time: {
          created: Date.now(),
        },
      };
      await Storage.write<Info>(['project', 'global'], project);
      return project;
    }
    let worktree = path.dirname(git);
    const timer = log.time('git.rev-parse');
    // In a git worktree or submodule `.git` is a file, so the id cache lives in
    // the common git directory instead (as upstream does). Writing to
    // `.git/opencode` there used to reject with ENOTDIR; the rejection was not
    // handled and the CLI exited with an UnhandledRejection (issue #335).
    const cacheDir = await gitCacheDir(git, worktree);
    let id = await Bun.file(path.join(cacheDir, 'opencode'))
      .text()
      .then((x) => x.trim())
      .catch(() => {});
    if (!id) {
      const roots = await $`git rev-list --max-parents=0 --all`
        .quiet()
        .nothrow()
        .cwd(worktree)
        .text()
        .then((x) =>
          x
            .split('\n')
            .filter(Boolean)
            .map((x) => x.trim())
            .toSorted()
        );
      id = roots[0];
      // The cache is best effort: a read-only or unusual `.git` must not fail
      // project detection.
      if (id)
        await Bun.write(path.join(cacheDir, 'opencode'), id).catch((error) =>
          log.info(() => ({
            message: 'project id cache not written',
            path: path.join(cacheDir, 'opencode'),
            error: String(error),
          }))
        );
    }
    timer.stop();
    if (!id) {
      const project: Info = {
        id: 'global',
        worktree: '/',
        time: {
          created: Date.now(),
        },
      };
      await Storage.write<Info>(['project', 'global'], project);
      return project;
    }
    worktree = await $`git rev-parse --path-format=absolute --show-toplevel`
      .quiet()
      .nothrow()
      .cwd(worktree)
      .text()
      .then((x) => x.trim());
    const project: Info = {
      id,
      worktree,
      vcs: 'git',
      time: {
        created: Date.now(),
      },
    };
    await Storage.write<Info>(['project', id], project);
    return project;
  }

  /**
   * Directory that holds the project id cache: `.git` itself when it is a
   * directory, otherwise the common git directory reported by git (worktrees
   * and submodules have a `.git` file pointing elsewhere).
   */
  async function gitCacheDir(git: string, worktree: string): Promise<string> {
    const stat = await fs.stat(git).catch(() => undefined);
    if (stat?.isDirectory()) return git;
    const common =
      await $`git rev-parse --path-format=absolute --git-common-dir`
        .quiet()
        .nothrow()
        .cwd(worktree)
        .text()
        .then((x) => x.trim())
        .catch(() => '');
    return common || git;
  }

  export async function setInitialized(projectID: string) {
    await Storage.update<Info>(['project', projectID], (draft) => {
      draft.time.initialized = Date.now();
    });
  }

  export async function list() {
    const keys = await Storage.list(['project']);
    return await Promise.all(keys.map((x) => Storage.read<Info>(x)));
  }

  export async function prune() {
    const root = path.join(Global.Path.data, 'snapshot');
    const entries = await fs
      .readdir(root, { withFileTypes: true })
      .catch(() => []);
    const snapshots: { id: string; path: string; modified: number }[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const snapshot = path.join(root, entry.name);
      const modified = await fs
        .stat(snapshot)
        .then((stat) => stat.mtimeMs)
        .catch(() => undefined);
      if (modified === undefined) continue;
      snapshots.push({ id: entry.name, path: snapshot, modified });
    }
    snapshots.sort((a, b) => b.modified - a.modified);

    const newest = snapshots[0]?.id;
    const recent = Date.now() - recentSnapshotAge;
    for (const snapshot of snapshots) {
      if (snapshot.id === newest || snapshot.modified >= recent) continue;
      const project = await Storage.read<Info>(['project', snapshot.id]).catch(
        () => undefined
      );
      const live = project
        ? await fs
            .stat(project.worktree)
            .then((stat) => stat.isDirectory())
            .catch(() => false)
        : false;
      if (live) continue;

      await remove(snapshot).catch((error) =>
        log.warn(() => ({
          message: 'failed to prune snapshot',
          projectID: snapshot.id,
          error: error instanceof Error ? error.message : String(error),
        }))
      );
    }
  }

  async function remove(snapshot: { id: string; path: string }) {
    await fs.rm(snapshot.path, { recursive: true, force: true });
    for (const session of await Storage.list(['session', snapshot.id])) {
      const sessionID = session.at(-1)!;
      for (const message of await Storage.list(['message', sessionID])) {
        const messageID = message.at(-1)!;
        for (const part of await Storage.list(['part', messageID])) {
          await Storage.remove(part);
        }
        await Storage.remove(message);
      }
      await Storage.remove(['session_diff', sessionID]);
      await Storage.remove(['todo', sessionID]);
      await Storage.remove(session);
    }
    await Storage.remove(['project', snapshot.id]);
    log.info(() => ({ message: 'pruned snapshot', projectID: snapshot.id }));
  }
}
