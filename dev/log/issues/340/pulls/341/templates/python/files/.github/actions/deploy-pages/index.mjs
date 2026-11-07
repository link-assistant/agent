// JavaScript actions run on the runner's Node.js 24 and get inputs as INPUT_* variables.
import { fail, main } from './deploy.mjs';

main().catch(fail);
