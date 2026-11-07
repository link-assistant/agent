// Finds tests whose coverage depends on the runner without the summary saying
// so. A test registered only under some condition is never heard of where the
// condition is false: the suite just has fewer tests. A test body that returns
// early on an environment check is reported as passed without asserting
// anything. Register such tests through tests/helpers/skip.js instead, which
// reports the skip and its reason.

const REGISTRATION = /^(?:it|test|describe)(?:\.\w+)?\(/;
const DESCRIBE_OPENER = /\bdescribe(?:\.\w+)?\(.*=>\s*\{$/;
const TEST_OPENER = /\b(?:it|test)(?:\.\w+)?\(.*=>\s*\{$/;
const RETURN = /^\s*return;?\s*(?:\/\/.*)?$/;
// `cond ? describe : () => {}` registers nothing when cond is false, and
// test-anywhere's describe.skip registers nothing at all on Deno
// (https://github.com/link-foundation/test-anywhere/issues/149).
const SWAPPED =
  /\?\s*(?:it|test|describe)(?:\.\w+)?\s*:|\?[^:]*:\s*(?:it|test|describe)(?:\.\w+)?\s*;|\bdescribe\.skip\b/;
// Conditions about the runner, not about the code under test.
const ENVIRONMENT =
  /\bDeno\b|readOnlyRuntime|process\.platform|\bcan[A-Z]\w*|\bis[A-Z]\w*Runtime\b|unsupported\(/;

function indentOf(line) {
  return line.length - line.trimStart().length;
}

function blockEnd(lines, start) {
  const indent = indentOf(lines[start]);
  let end = start + 1;
  while (
    end < lines.length &&
    !(indentOf(lines[end]) === indent && lines[end].trimStart().startsWith('}'))
  ) {
    end += 1;
  }
  return end;
}

function enclosingOpener(lines, index) {
  const indent = indentOf(lines[index]);
  for (let previous = index - 1; previous >= 0; previous -= 1) {
    const line = lines[previous];
    if (line.trim() !== '' && indentOf(line) < indent) {
      return line;
    }
  }
  return '';
}

/**
 * @param {string[]} lines
 * @param {number} index line of an `if (` statement
 * @param {string} condition the text between its parentheses
 * @returns {string|null} finding kind
 */
function classifyIf(lines, index, condition) {
  const line = lines[index];
  const oneLine = /\)\s*(?:\{\s*)?return;?\s*\}?\s*(?:\/\/.*)?$/.test(line);
  const body = oneLine ? [] : lines.slice(index + 1, blockEnd(lines, index));
  const indent = indentOf(line);
  if (
    body.some(
      (bodyLine) =>
        indentOf(bodyLine) === indent + 2 &&
        REGISTRATION.test(bodyLine.trimStart())
    )
  ) {
    return 'wrapped';
  }

  const returnsOnly = oneLine || (body.length === 1 && RETURN.test(body[0]));
  const opener = enclosingOpener(lines, index);
  if (returnsOnly && DESCRIBE_OPENER.test(opener)) {
    // Everything the describe callback registers after this is lost.
    return 'early-return';
  }
  const returns = returnsOnly || RETURN.test(body.at(-1) ?? '');
  if (returns && TEST_OPENER.test(opener) && ENVIRONMENT.test(condition)) {
    // The test is reported as passed, with or without a logged note.
    return 'silent-pass';
  }
  return null;
}

/**
 * @param {string} source test file contents
 * @returns {{line: number, kind: string, text: string}[]}
 */
export function findConditionalRegistrations(source) {
  const lines = source.replaceAll('\r\n', '\n').split('\n');
  const findings = [];

  lines.forEach((line, index) => {
    const condition = line.match(/^\s*if \((.*)\)/);
    let kind = null;
    if (SWAPPED.test(line) && !line.trimStart().startsWith('//')) {
      kind = 'swapped';
    } else if (condition) {
      kind = classifyIf(lines, index, condition[1]);
    }
    if (kind) {
      findings.push({ line: index + 1, kind, text: line.trim() });
    }
  });

  return findings;
}
