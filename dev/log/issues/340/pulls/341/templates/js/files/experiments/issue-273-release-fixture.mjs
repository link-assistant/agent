// Offline command-stream seam for the real formatter CLIs. Never contacts GitHub.
import { register } from 'command-stream';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
const fixture = JSON.parse(readFileSync(process.env.RELEASE_FIXTURE, 'utf8'));
register('gh', ({ args, stdin }) => {
  appendFileSync(
    `${process.env.RELEASE_FIXTURE}.calls`,
    `${JSON.stringify(args)}\n`
  );
  if (args.includes('PATCH')) {
    writeFileSync(`${process.env.RELEASE_FIXTURE}.patch`, stdin || '');
    return { code: 0, stdout: '{}' };
  }
  const lookup = args.some((arg) => arg.includes('/commits/'))
    ? fixture.prs
    : fixture.release;
  return {
    code: lookup.code ?? 0,
    stdout:
      typeof lookup.body === 'string'
        ? lookup.body
        : JSON.stringify(lookup.body),
    stderr: lookup.error ?? '',
  };
});
