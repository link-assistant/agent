// Native JavaScript behavior draft for existing Rust maintenance helpers.
// This is an executable specification, not a claim that the Rust template has
// been ported. The production JS-first readiness inventory remains independent.
import assert from 'node:assert/strict';
import test from 'node:test';

export function releaseSection(content, version) {
  let fence;
  let start;
  let offset = 0;
  for (const line of content.match(/[^\n]*\n|[^\n]+$/g) ?? []) {
    const text = line.replace(/\r?\n$/, '');
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(text);
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) fence = undefined;
    } else if (marker && (marker[1][0] === '~' || !marker[2].includes('`'))) {
      fence = marker[1];
    } else {
      const heading = /^ {0,3}## \[([^\]]+)\](?:\s.*)?$/.exec(text);
      if (heading) {
        if (start !== undefined) return content.slice(start, offset);
        if (heading[1] === version) start = offset + line.length;
      }
    }
    offset += line.length;
  }
  if (start === undefined) throw new Error('Missing release entry');
  return content.slice(start);
}

test('fenced release examples and CRLF preserve every body byte', () => {
  for (const delimiter of ['```', '~~~~']) {
    const body = `\r\n  Example:\r\n${delimiter}md\r\n## [9.9.9]\r\n${delimiter}\r\n\r\n### Fixed\r\n  Remaining details.\r\n\r\n`;
    const content = `## [1.2.3]\r\n${body}## [1.2.2]\r\nold`;
    assert.equal(releaseSection(content, '1.2.3'), body);
    assert.throws(() => releaseSection(content, '9.9.9'));
  }
});

test('path exclusions match only whole root-relative components', () => {
  const excluded = (relative) => relative.split('/').some((part) => ['target', '.git', 'node_modules'].includes(part));
  for (const relative of ['src/retarget.rs', 'src/target_matcher.rs', '.github/scripts/tool.rs']) assert.equal(excluded(relative), false);
  for (const relative of ['target/tool.rs', '.git/config', 'nested/node_modules/a.rs']) assert.equal(excluded(relative), true);
});

test('registry uncertainty is an error; only 404 establishes absence', () => {
  const classify = (status) => status === 404 ? 'absent' : status === 200 ? 'present' : status === 429 || status >= 500 ? 'retry' : 'error';
  assert.deepEqual([200, 404, 401, 403, 429, 503].map(classify), ['present', 'absent', 'error', 'error', 'retry', 'retry']);
});
