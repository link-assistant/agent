// Test: Hash key with fetch function
const fn1 = async () => {};
const fn2 = async () => {};

const options1 = { apiKey: 'public', fetch: fn1 };
const options2 = { apiKey: 'public', fetch: fn2 };
const options3 = { apiKey: 'public' };

console.log("JSON.stringify with fetch:", JSON.stringify({ pkg: '@ai-sdk/anthropic', options: options1 }));
console.log("JSON.stringify without fetch:", JSON.stringify({ pkg: '@ai-sdk/anthropic', options: options3 }));

// Functions are stripped by JSON.stringify!
const hash1 = Bun.hash.xxHash32(JSON.stringify({ pkg: '@ai-sdk/anthropic', options: options1 }));
const hash2 = Bun.hash.xxHash32(JSON.stringify({ pkg: '@ai-sdk/anthropic', options: options2 }));
const hash3 = Bun.hash.xxHash32(JSON.stringify({ pkg: '@ai-sdk/anthropic', options: options3 }));

console.log("\nHash with fn1:", hash1);
console.log("Hash with fn2:", hash2);
console.log("Hash without fn:", hash3);
console.log("All same?", hash1 === hash2 && hash2 === hash3);
