import * as fs from 'fs';
import * as path from 'path';
import { Instance } from '../project/instance';
import { Log } from '../util/log';

export namespace FileTime {
  const log = Log.create({ service: 'file.time' });

  // What we knew about a file when the session last read (or wrote) it.
  // Comparing mtime/size for equality instead of `mtime > readTime` avoids
  // false "modified since read" errors for files whose mtime is in the
  // future (clock skew, archives, network mounts) and still catches edits
  // made within the same millisecond as the read (upstream #23483).
  export type Stamp = {
    read: Date;
    mtime: number | undefined;
    size: number | undefined;
  };

  export const state = Instance.state(() => {
    const read: {
      [sessionID: string]: {
        [path: string]: Stamp | undefined;
      };
    } = {};
    const locks = new Map<string, Promise<void>>();
    return {
      read,
      locks,
    };
  });

  // `dir/./a.txt`, `dir/a.txt`, relative paths and symlinked paths of the
  // same file must share one entry (and one lock).
  export function normalize(file: string) {
    const resolved = path.resolve(Instance.directory, file);
    try {
      return fs.realpathSync(resolved);
    } catch {
      // Not created yet: canonicalize the parent so the key does not change
      // once the file exists (e.g. /tmp -> /private/tmp on macOS).
      try {
        return path.join(
          fs.realpathSync(path.dirname(resolved)),
          path.basename(resolved)
        );
      } catch {
        return resolved;
      }
    }
  }

  function stamp(file: string): Stamp {
    try {
      const info = fs.statSync(file);
      return { read: new Date(), mtime: info.mtimeMs, size: info.size };
    } catch {
      return { read: new Date(), mtime: undefined, size: undefined };
    }
  }

  export function read(sessionID: string, file: string) {
    file = normalize(file);
    log.info(() => ({ message: 'read', sessionID, file }));
    const { read } = state();
    read[sessionID] = read[sessionID] || {};
    read[sessionID][file] = stamp(file);
  }

  export function get(sessionID: string, file: string) {
    return state().read[sessionID]?.[normalize(file)]?.read;
  }

  export async function assert(sessionID: string, filepath: string) {
    filepath = normalize(filepath);
    const time = state().read[sessionID]?.[filepath];
    if (!time)
      throw new Error(
        `You must read the file ${filepath} before overwriting it. Use the Read tool first`
      );
    const next = stamp(filepath);
    if (next.mtime === time.mtime && next.size === time.size) return;
    throw new Error(
      `File ${filepath} has been modified since it was last read.\nLast modification: ${new Date(next.mtime ?? next.read.getTime()).toISOString()}\nLast read: ${time.read.toISOString()}\n\nPlease read the file again before modifying it.`
    );
  }

  // Serializes read-modify-write cycles on one file. Tool calls of a single
  // step run concurrently (and `batch` uses Promise.all), so without this two
  // edits of the same file both read the old content and the last write wins,
  // silently dropping the other edit (upstream 5cf126d489).
  export async function withLock<T>(
    filepath: string,
    fn: () => Promise<T>
  ): Promise<T> {
    filepath = normalize(filepath);
    const { locks } = state();
    const current = locks.get(filepath) ?? Promise.resolve();
    let release: () => void = () => {};
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });
    const chained = current.then(() => next);
    locks.set(filepath, chained);
    await current;
    try {
      return await fn();
    } finally {
      release();
      if (locks.get(filepath) === chained) locks.delete(filepath);
    }
  }
}
