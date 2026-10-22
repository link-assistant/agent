// Proves Tool.define() re-wraps execute on each init() of object-defined tools
// (upstream fix 81d3ac3bf0, #16952). Run:
//   bun experiments/issue-335/bash-web/define-accumulation.ts
import z from 'zod';
const SRC = new URL('../../../js/src', import.meta.url).pathname;
const { Tool } = await import(`${SRC}/tool/tool`);

let parses = 0;
const schema = z.object({ x: z.string() });
const orig = schema.parse.bind(schema);
(schema as any).parse = (v: unknown) => {
  parses++;
  return orig(v);
};
const T = Tool.define('probe', {
  description: 'probe',
  parameters: schema,
  async execute() {
    return { title: '', output: 'ok', metadata: {} };
  },
});

// ToolRegistry.tools() calls init() for every tool on every agent step.
for (let i = 0; i < 100; i++) await T.init();
const info = await T.init();
parses = 0;
await info.execute({ x: 'a' }, {} as any);
console.log('parse() calls for ONE execute after 101 init():', parses);

for (let i = 0; i < 200000; i++) await T.init();
try {
  await (await T.init()).execute({ x: 'a' }, {} as any);
  console.log('200k inits: still ok');
} catch (e) {
  console.log('200k inits: execute threw ->', String(e).slice(0, 120));
}
