import os from 'os';
import path from 'path';

/**
 * Host integration contract: how an embedding host hands the CLI its config.
 *
 * A host supplies configuration through the CLI's own variables:
 *
 *   LINK_ASSISTANT_AGENT_CONFIG_DIR      a directory holding opencode.json(c)
 *   LINK_ASSISTANT_AGENT_CONFIG          a single config file
 *   LINK_ASSISTANT_AGENT_CONFIG_CONTENT  the config itself, as JSON
 *
 * Relocating `XDG_CONFIG_HOME` to feed the CLI a generated config also moves
 * the config home of every tool the agent runs — `gh` then finds no
 * `hosts.yml` and the session loses GitHub authentication (#314). This module
 * spots that setup so the CLI can point the host at the variables above.
 *
 * @see https://github.com/link-assistant/agent/issues/314
 * @see ../../../docs/host-integration.md
 */
export namespace HostConfigHint {
  export const CONFIG_ENV_VARS = [
    'LINK_ASSISTANT_AGENT_CONFIG_DIR',
    'LINK_ASSISTANT_AGENT_CONFIG',
    'LINK_ASSISTANT_AGENT_CONFIG_CONTENT',
  ] as const;

  export interface Hint {
    message: string;
    xdgConfigHome: string;
    realConfigHome: string;
    hint: string;
  }

  /**
   * Return a hint when `XDG_CONFIG_HOME` points away from the user's real
   * config home and none of the CLI's own config variables is set — the
   * signature of a host relocating XDG to deliver config. Pure, so it can be
   * tested with any environment.
   */
  export function detect(
    env: Record<string, string | undefined> = process.env,
    homedir: string = os.homedir()
  ): Hint | undefined {
    const xdgConfigHome = env.XDG_CONFIG_HOME?.trim();
    if (!xdgConfigHome) return undefined;

    const realConfigHome = path.join(homedir, '.config');
    if (path.resolve(xdgConfigHome) === path.resolve(realConfigHome)) {
      return undefined;
    }

    if (CONFIG_ENV_VARS.some((name) => env[name]?.trim())) return undefined;

    return {
      message: 'XDG_CONFIG_HOME is relocated',
      xdgConfigHome,
      realConfigHome,
      hint: `To supply agent config, set ${CONFIG_ENV_VARS.join(', ')} instead of XDG_CONFIG_HOME: tools the agent runs (gh, git) read their config and credentials from XDG_CONFIG_HOME too`,
    };
  }
}
