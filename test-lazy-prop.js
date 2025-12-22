import { Log } from './src/util/log.ts';
const desc = Object.getOwnPropertyDescriptor(Log.Default, 'lazy');
console.log('lazy property descriptor:', desc);
if (desc && desc.get) {
  console.log('Calling getter:', desc.get());
}
