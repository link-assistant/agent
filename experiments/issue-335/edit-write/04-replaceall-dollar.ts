// The pre-fix replaceAll branch of js/src/tool/edit.ts used
// `content.replaceAll(search, newString)`, which expands `$$`, `$&`, `$'`.
const { replace } = await import(
  new URL('../../../js/src/tool/edit.ts', import.meta.url).pathname
);
const content = 'price = A\nother = A\n';
const raw = content.replaceAll('A', '$$5 and $& done');
console.log('String#replaceAll:', JSON.stringify(raw));
const out = replace(content, 'A', '$$5 and $& done', true);
console.log('edit replace():   ', JSON.stringify(out));
console.log(
  out.includes('$$5 and $& done')
    ? 'OK: newString inserted literally'
    : 'BUG: $$ collapsed to $ and $& expanded to match'
);
