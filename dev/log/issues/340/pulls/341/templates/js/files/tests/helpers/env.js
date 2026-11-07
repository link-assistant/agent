/**
 * Environments for fixtures that must not see some of the runner's variables.
 *
 * Node gives a child exactly the `env` it is passed. Deno's spawnSync and
 * execFileSync merge that `env` into the parent's environment instead (async
 * spawn does not), so a variable deleted from the copy still reaches the
 * child: on GitHub Actions a fixture that deleted CI ran with CI=true. A blank
 * value reaches the child on every runtime, and the scripts read these
 * variables as truthy strings, so blank means unset to them.
 * https://github.com/denoland/deno/issues/36996
 */

/**
 * @param {Record<string, string|undefined>} env environment to copy
 * @param {(name: string) => boolean} drop names the child must not see
 * @returns {Record<string, string|undefined>} a copy with those names blank
 */
export function blankEnv(env, drop) {
  const copy = { ...env };
  for (const name of Object.keys(copy)) {
    if (drop(name)) {
      copy[name] = '';
    }
  }
  return copy;
}
