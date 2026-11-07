import { URL } from 'node:url';
/** Bounded local browser reproduction of the real OAuth error callback. */
import { writeFileSync } from 'node:fs';
import { GooglePlugin } from '../../js/src/auth/google-plugin.ts';

const mode = process.argv[2] || 'before';
const flow = await GooglePlugin.methods[0].authorize();
const callback = flow.callback();
const url = new URL(new URL(flow.url).searchParams.get('redirect_uri'));
url.searchParams.set(
  'error',
  '<script>document.body.dataset.injected="true"</script><strong>Injected markup</strong>'
);
writeFileSync(`/tmp/issue-340-oauth-${mode}.url`, url.href);
console.log(`Browser reproduction ready: ${mode}`);
// Keep the fixture available briefly; the browser request completes auth locally.
const guard = setTimeout(() => process.exit(1), 60000);
console.log(await callback);
clearTimeout(guard);
// The original implementation leaves a five-minute auth timer running.
process.exit(0);
