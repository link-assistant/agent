// read.ts L130-183: no byte cap on the returned text (upstream: MAX_BYTES 50 KB, c1b03b728a / 1b82511fbd).
import { formatBalancedLineWindow } from '../../../js/src/tool/text-window.ts';
const lines = Array.from({ length: 1999 }, () => 'var a=' + 'x'.repeat(5000)); // e.g. a minified/generated file
const content = lines.map(
  (line, i) =>
    `${(i + 1).toString().padStart(5, '0')}| ${formatBalancedLineWindow({ line, lineNumber: i + 1, limit: 2000 })}`
);
const out =
  '<file>\n' +
  content.join('\n') +
  `\n\n(End of file - total ${lines.length} lines)\n</file>`;
console.log(
  `default read output: ${(out.length / 1024).toFixed(0)} KiB (~${Math.round(out.length / 4 / 1000)}k tokens); upstream cap: 50 KiB`
);
