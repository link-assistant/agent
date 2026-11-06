// Reproduces: replace(content, '', x) never returns (MultiOccurrenceReplacer
// loops forever because indexOf('', i) always succeeds).
import { replace } from '../../js/src/tool/edit.ts';
const which = process.argv[2];
if (which === 'close') {
  console.log(
    JSON.stringify(
      replace(
        ['start', '  value = compute(1, 2);', 'end'].join('\n'),
        ['start', '  value = compute(1, 3);', 'end'].join('\n'),
        'replaced'
      )
    )
  );
} else {
  console.log(JSON.stringify(replace('abc', '', 'x')));
}
