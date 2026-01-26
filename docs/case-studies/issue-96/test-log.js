import { Log } from './src/util/log.ts';

// Test that Log.Default.lazy.info works
console.log('Testing Log.Default.lazy.info...');
try {
  Log.Default.lazy.info(() => ({ message: 'Test lazy logging' }));
  console.log('✅ Log.Default.lazy.info works!');
} catch (error) {
  console.log('❌ Error:', error.message);
}

// Test that Log.Default.info works
console.log('Testing Log.Default.info...');
try {
  Log.Default.info(() => ({ message: 'Test direct logging' }));
  console.log('✅ Log.Default.info works!');
} catch (error) {
  console.log('❌ Error:', error.message);
}
