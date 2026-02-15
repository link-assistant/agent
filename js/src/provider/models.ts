import { Global } from '../global';
import { Log } from '../util/log';
import path from 'path';
import z from 'zod';
import { data } from './models-macro';

export namespace ModelsDev {
  const log = Log.create({ service: 'models.dev' });
  const filepath = path.join(Global.Path.cache, 'models.json');

  export const Model = z
    .object({
      id: z.string(),
      name: z.string(),
      release_date: z.string(),
      attachment: z.boolean(),
      reasoning: z.boolean(),
      temperature: z.boolean(),
      tool_call: z.boolean(),
      cost: z.object({
        input: z.number(),
        output: z.number(),
        cache_read: z.number().optional(),
        cache_write: z.number().optional(),
        context_over_200k: z
          .object({
            input: z.number(),
            output: z.number(),
            cache_read: z.number().optional(),
            cache_write: z.number().optional(),
          })
          .optional(),
      }),
      limit: z.object({
        context: z.number(),
        output: z.number(),
      }),
      modalities: z
        .object({
          input: z.array(z.enum(['text', 'audio', 'image', 'video', 'pdf'])),
          output: z.array(z.enum(['text', 'audio', 'image', 'video', 'pdf'])),
        })
        .optional(),
      experimental: z.boolean().optional(),
      status: z.enum(['alpha', 'beta', 'deprecated']).optional(),
      options: z.record(z.string(), z.any()),
      headers: z.record(z.string(), z.string()).optional(),
      provider: z.object({ npm: z.string() }).optional(),
    })
    .meta({
      ref: 'Model',
    });
  export type Model = z.infer<typeof Model>;

  export const Provider = z
    .object({
      api: z.string().optional(),
      name: z.string(),
      env: z.array(z.string()),
      id: z.string(),
      npm: z.string().optional(),
      models: z.record(z.string(), Model),
    })
    .meta({
      ref: 'Provider',
    });

  export type Provider = z.infer<typeof Provider>;

  /**
   * Cache staleness threshold in milliseconds (1 hour).
   * If the cache is older than this, we await the refresh before using the data.
   */
  const CACHE_STALE_THRESHOLD_MS = 60 * 60 * 1000;

  /**
   * Get the models database, refreshing from models.dev if needed.
   *
   * This function handles cache staleness properly:
   * - If cache doesn't exist: await refresh to ensure fresh data
   * - If cache is stale (> 1 hour old): await refresh to ensure up-to-date models
   * - If cache is fresh: trigger background refresh but use cached data immediately
   *
   * This prevents ProviderModelNotFoundError when:
   * - User runs agent for the first time (no cache)
   * - User has outdated cache missing new models like kimi-k2.5-free
   *
   * @see https://github.com/link-assistant/agent/issues/175
   */
  export async function get() {
    const file = Bun.file(filepath);

    // Check if cache exists and get its modification time
    const exists = await file.exists();

    if (!exists) {
      // No cache - must await refresh to get initial data
      log.info(() => ({
        message: 'no cache found, awaiting refresh',
        path: filepath,
      }));
      await refresh();
    } else {
      // Check if cache is stale
      const stats = await file.stat().catch(() => null);
      const mtime = stats?.mtime?.getTime() ?? 0;
      const isStale = Date.now() - mtime > CACHE_STALE_THRESHOLD_MS;

      if (isStale) {
        // Stale cache - await refresh to get updated model list
        log.info(() => ({
          message: 'cache is stale, awaiting refresh',
          path: filepath,
          age: Date.now() - mtime,
          threshold: CACHE_STALE_THRESHOLD_MS,
        }));
        await refresh();
      } else {
        // Fresh cache - trigger background refresh but don't wait
        log.info(() => ({
          message: 'cache is fresh, triggering background refresh',
          path: filepath,
          age: Date.now() - mtime,
        }));
        refresh();
      }
    }

    // Now read the cache file
    const result = await file.json().catch(() => {});
    if (result) return result as Record<string, Provider>;

    // Fallback to bundled data if cache read failed
    // This is expected behavior when the cache is unavailable or corrupted
    // Using info level since bundled data is a valid fallback mechanism
    // @see https://github.com/link-assistant/agent/issues/177
    log.info(() => ({
      message: 'cache unavailable, using bundled data',
      path: filepath,
    }));
    const json = await data();
    return JSON.parse(json) as Record<string, Provider>;
  }

  export async function refresh() {
    const file = Bun.file(filepath);
    log.info(() => ({ message: 'refreshing', file }));
    const result = await fetch('https://models.dev/api.json', {
      headers: {
        'User-Agent': 'agent-cli/1.0.0',
      },
      signal: AbortSignal.timeout(10 * 1000),
    }).catch((e) => {
      log.error(() => ({
        message: 'Failed to fetch models.dev',
        error: e,
      }));
    });
    if (result && result.ok) await Bun.write(file, await result.text());
  }
}

setInterval(() => ModelsDev.refresh(), 60 * 1000 * 60).unref();
