// Bounded offline reproduction of #125: two bytes reach unzip-stream's parser.
// Run after npm ci --prefix .github/actions/artifact:
// node --pending-deprecation --throw-deprecation experiments/reproduce_artifact_buffer.mjs
import unzip from '../.github/actions/artifact/node_modules/unzip-stream/unzip.js';
const parser = unzip.Parse();
parser.on('error', () => {});
parser.write(Buffer.from([0x50, 0x4b]));
parser.destroy();
