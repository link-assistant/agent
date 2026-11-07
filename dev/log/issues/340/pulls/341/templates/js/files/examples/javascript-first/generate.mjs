import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { URL } from 'node:url';

const read = (name) => readFileSync(new URL(name, import.meta.url), 'utf8');
const hash = (text) => createHash('sha256').update(text).digest('hex');
const source = read('./native.mjs').replaceAll('\r\n', '\n');
// This deliberately small translator supports exactly this typed function.
// Any changed/unsupported behavior is refused, never copied into the target.
const supported =
  /^export function isEven\(value\) \{\s+if \(!Number\.isInteger\(value\) \|\| value < -2147483648 \|\| value > 2147483647\) \{\s+throw new RangeError\('Expected a signed 32-bit integer'\);\s+\}\s+return value % 2 === 0;\s+\}\s*$/;
assert.match(source, supported, 'Unsupported source: translation refused');
const pins = {
  sourceSha256: hash(source),
  generatorSha256: hash(read('./generate.mjs').replaceAll('\r\n', '\n')),
  dependencies: [],
};
if (process.argv.includes('--update-pins')) {
  writeFileSync(
    new URL('./pins.json', import.meta.url),
    `${JSON.stringify(pins, null, 2)}\n`
  );
}
assert.deepEqual(
  JSON.parse(read('./pins.json')),
  pins,
  'Source and translator must match reviewed pins'
);
const ir = {
  sourceSha256: pins.sourceSha256,
  name: 'is_even',
  input: 'i32',
  output: 'bool',
  expression: {
    operator: 'eq',
    left: { operator: 'rem', left: 'value', right: 2 },
    right: 0,
  },
};
const cases = JSON.parse(read('./cases.json'));
const rust = `// Generated from native.mjs sha256:${pins.sourceSha256}\npub fn ${ir.name}(value: ${ir.input}) -> ${ir.output} { value % 2 == 0 }\n\n#[test]\nfn shared_observations() {\n${cases.map(([input, expected]) => `    assert_eq!(is_even(${input}), ${expected});`).join('\n')}\n}\n`;
for (const [name, content] of Object.entries({
  'generated/typed-ir.json': `${JSON.stringify(ir, null, 2)}\n`,
  'generated/lib.rs': rust,
})) {
  if (process.argv.includes('--check')) {
    assert.equal(
      read(`./${name}`).replaceAll('\r\n', '\n'),
      content,
      `${name} has generated drift`
    );
  } else {
    writeFileSync(new URL(`./${name}`, import.meta.url), content);
  }
}
