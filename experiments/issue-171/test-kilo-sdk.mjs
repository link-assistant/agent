/**
 * Test script: Verify Kilo SDK integration with @openrouter/ai-sdk-provider
 *
 * Tests:
 * 1. SDK loads correctly
 * 2. Model creation works with correct base URL
 * 3. Device auth initiation works
 * 4. Model listing works (anonymous access)
 *
 * To test with actual API call, first authenticate:
 *   agent auth login  (select Kilo Gateway)
 *   Then set: KILO_API_KEY=<your-token> bun run experiments/issue-171/test-kilo-sdk.mjs
 */

const KILO_API_BASE = 'https://api.kilo.ai';
const KILO_OPENROUTER_URL = `${KILO_API_BASE}/api/openrouter`;

console.log('=== Kilo Provider Integration Test ===\n');

// Test 1: Verify @openrouter/ai-sdk-provider loads
console.log('Test 1: Loading @openrouter/ai-sdk-provider...');
try {
  const { createOpenRouter } = await import('@openrouter/ai-sdk-provider');
  console.log('  OK: Package loaded successfully\n');

  // Test 2: Create provider with correct base URL
  console.log('Test 2: Creating Kilo provider with correct base URL...');
  const apiKey = process.env.KILO_API_KEY || 'anonymous';
  const provider = createOpenRouter({
    baseURL: KILO_OPENROUTER_URL,
    apiKey,
    headers: {
      'User-Agent': 'opencode-kilo-provider',
      'X-KILOCODE-EDITORNAME': 'link-assistant-agent',
    },
  });
  console.log(`  OK: Provider created (apiKey: ${apiKey === 'anonymous' ? 'anonymous' : '***'})\n`);

  // Test 3: Create model
  console.log('Test 3: Creating model z-ai/glm-5...');
  const model = provider.languageModel('z-ai/glm-5');
  console.log(`  OK: Model created (modelId: ${model.modelId})\n`);

  // Test 4: If we have a real API key, try a completion
  if (apiKey !== 'anonymous') {
    console.log('Test 4: Testing completion with authenticated API key...');
    const { generateText } = await import('ai');
    try {
      const result = await generateText({
        model,
        messages: [{ role: 'user', content: "Say 'hello' in one word" }],
        maxTokens: 10,
      });
      console.log(`  OK: Completion successful`);
      console.log(`  Response: "${result.text}"\n`);
    } catch (e) {
      console.log(`  FAIL: ${e.message}`);
      if (e.statusCode) console.log(`  Status: ${e.statusCode}`);
      if (e.responseBody) console.log(`  Body: ${e.responseBody}\n`);
    }
  } else {
    console.log('Test 4: Skipped (no KILO_API_KEY set, anonymous access may be rejected)\n');
  }
} catch (e) {
  console.log(`  FAIL: ${e.message}\n`);
}

// Test 5: Device auth API
console.log('Test 5: Testing device auth initiation...');
try {
  const response = await fetch(`${KILO_API_BASE}/api/device-auth/codes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  if (response.ok) {
    const data = await response.json();
    console.log(`  OK: Device auth initiated`);
    console.log(`  Code: ${data.code}`);
    console.log(`  URL: ${data.verificationUrl}`);
    console.log(`  Expires in: ${data.expiresIn}s\n`);
  } else {
    console.log(`  FAIL: HTTP ${response.status}\n`);
  }
} catch (e) {
  console.log(`  FAIL: ${e.message}\n`);
}

// Test 6: Models listing (anonymous access works for this)
console.log('Test 6: Testing models listing...');
try {
  const response = await fetch(`${KILO_OPENROUTER_URL}/models`, {
    headers: {
      'Authorization': 'Bearer anonymous',
      'Content-Type': 'application/json',
    },
  });
  if (response.ok) {
    const data = await response.json();
    const models = data.data || [];
    const glmModels = models.filter((m) => m.id.includes('glm'));
    console.log(`  OK: ${models.length} models available`);
    console.log(`  GLM models found: ${glmModels.map((m) => m.id).join(', ') || 'none'}`);
    const freeModels = models.filter((m) => {
      const input = parseFloat(m.pricing?.prompt || '1');
      return input === 0;
    });
    console.log(`  Free models: ${freeModels.length}\n`);
  } else {
    console.log(`  FAIL: HTTP ${response.status}\n`);
  }
} catch (e) {
  console.log(`  FAIL: ${e.message}\n`);
}

console.log('=== Tests Complete ===');
