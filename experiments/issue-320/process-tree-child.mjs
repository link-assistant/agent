import { appendFileSync } from 'node:fs';

setInterval(() => appendFileSync(process.argv[2], 'x'), 20);
