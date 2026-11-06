import { runCommand, runStrict } from './run-command.mjs';

/** Check only staged files that still exist in the index. */
export async function checkStagedFormatting({
  cwd,
  runner = runCommand,
  logger = console,
} = {}) {
  const options = { cwd, runner, logger };
  const staged = await runStrict(
    'git',
    ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'],
    options
  );
  const formattable = staged.stdout
    .split('\0')
    .filter((file) => /\.(m?js|json|md|ts)$/.test(file));

  if (formattable.length > 0) {
    logger.log(
      `Checking formatting of ${formattable.length} staged file(s) with prettier...`
    );
    await runStrict(
      'npx',
      ['--no-install', 'prettier', '--check', ...formattable],
      options
    );
  }

  return formattable;
}
