import { randomBytes } from 'node:crypto';

/** Return whether GitHub Actions is interpreting workflow commands. */
function isGitHubActions() {
  try {
    return process.env.GITHUB_ACTIONS === 'true';
  } catch {
    return false;
  }
}

/**
 * Print text that may have been authored by a contributor without allowing it
 * to become a GitHub Actions workflow command.
 *
 * GitHub requires a fresh, unpredictable resume token for every bracket. Hex
 * satisfies the runner's token validation and 16 random bytes provide 128 bits.
 * @param {unknown} value
 * @param {{stream?: {write: (text: string) => unknown}, githubActions?: boolean, tokenFactory?: () => string}} options
 */
export function printUntrusted(value, options = {}) {
  const stream = options.stream || process.stdout;
  const githubActions = options.githubActions ?? isGitHubActions();
  const text = String(value);

  if (!githubActions) {
    stream.write(`${text}\n`);
    return;
  }

  const tokenFactory =
    options.tokenFactory || (() => randomBytes(16).toString('hex'));
  const token = tokenFactory();

  stream.write(`::stop-commands::${token}\n`);
  stream.write(`${text}\n`);
  stream.write(`::${token}::\n`);
}
