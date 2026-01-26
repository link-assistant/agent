# Solution Proposal for Issue #36

## Problem Summary

Despite PR #35's fix that implements minimal system messages for low-limit models, CI tests still fail with 9,059 tokens requested (above the 6,000 TPM limit).

## Root Cause Hypothesis

After extensive investigation, I believe the issue is one of the following:

### Hypothesis A: Environment Information Still Being Added (MOST LIKELY)

The qwen.txt prompt file alone is **9,693 characters ≈ 2,770 tokens**. When combined with:

- Environment information (working directory, file tree): ~3,000-4,000 tokens
- Custom instructions (if any): ~1,000-2,000 tokens
- User message: ~15 tokens

This totals approximately **6,785-8,785 tokens**, which aligns with the observed **9,059 tokens**.

**The bug**: The environment and custom instructions may still be added despite `--system-message` override, OR the qwen.txt file is being used instead of the minimal message.

### Hypothesis B: File Tree is Extremely Large

If the repository has grown significantly, the file tree from `Ripgrep.tree()` (limited to 200 files) could be contributing thousands of tokens beyond normal estimates.

## Proposed Solutions

### Solution 1: Enhance System Message Override Logic (RECOMMENDED)

**Goal**: Ensure environment and file tree are completely skipped for ultra-low-limit models.

**Implementation**:

**Option A**: Modify `src/session/prompt.ts` to add explicit skip for environment when system override exists:

```typescript
async function resolveSystemPrompt(input: {
  system?: string;
  appendSystem?: string;
  agent: Agent.Info;
  providerID: string;
  modelID: string;
}) {
  // When system override is provided, use ONLY that (no env, no custom, no header)
  if (input.system) {
    return [input.system];
  }

  // Original logic for when no override
  let system = SystemPrompt.header(input.providerID);
  const base = input.agent.prompt
    ? [input.agent.prompt]
    : SystemPrompt.provider(input.modelID);
  if (input.appendSystem) {
    system.push(base[0] + '\n' + input.appendSystem);
  } else {
    system.push(...base);
  }
  system.push(...(await SystemPrompt.environment()));
  system.push(...(await SystemPrompt.custom()));

  const [first, ...rest] = system;
  return [first, rest.join('\n')];
}
```

**Pros**:

- Simple, surgical fix
- Guarantees minimal tokens when override provided
- Clear semantics: override = complete replacement

**Cons**:

- Changes existing behavior (removes header even for anthropic when override provided)
- May break users who expect environment + override

---

**Option B**: Add `--no-environment` flag for fine-grained control:

```javascript
// In src/index.js CLI options
.option('no-environment', {
  type: 'boolean',
  description: 'Skip environment and custom instructions',
  default: false
})

// In src/session/prompt.ts
if (!input.system && !input.noEnvironment) {
  system.push(...(await SystemPrompt.environment()))
  system.push(...(await SystemPrompt.custom()))
}
```

Then in test script:

```javascript
if (needsMinimalSystem) {
  args.push('--system-message', minimalSystemMessage, '--no-environment');
}
```

**Pros**:

- Explicit control
- Backwards compatible
- Users can combine system override with or without environment

**Cons**:

- Adds another CLI flag
- Requires test script changes

---

### Solution 2: Create Ultra-Minimal Prompt File

**Goal**: Replace qwen.txt with an ultra-minimal version for low-limit models.

**Implementation**:

Create `src/session/prompt/minimal.txt`:

```
You are a helpful AI assistant. Answer questions concisely.
```

Update `src/session/system.ts`:

```typescript
export function provider(modelID: string) {
  // Ultra-minimal for known low-limit models
  if (modelID.includes("qwen3-32b") || modelID.includes("mixtral-8x7b")) {
    return [PROMPT_MINIMAL]
  }

  // Existing logic
  if (modelID.includes("gpt-5")) return [PROMPT_CODEX]
  ...
}
```

**Pros**:

- No CLI changes needed
- Automatic for all qwen3-32b usage
- Clean separation of concerns

**Cons**:

- Reduces agent capabilities for these models
- Hardcoded model list maintenance burden
- Doesn't address root cause if environment is the issue

---

### Solution 3: Implement Token Budget System

**Goal**: Automatic token management based on model metadata.

**Implementation**: Add token budget to model definitions and automatically trim components to fit.

See full details in case study README.md under "Solution 4".

**Pros**:

- Automatic, no manual configuration
- Scales to all models

**Cons**:

- Complex implementation
- Requires model metadata updates

---

## Recommended Approach

**Implement Solution 1, Option A** (Enhanced system override logic):

### Rationale:

1. **Simplest fix** with highest confidence of resolving the issue
2. **Clear semantics**: `--system-message` means "use ONLY this, nothing else"
3. **Immediate impact**: Will definitely get us below 6,000 tokens
4. **Minimal risk**: Only affects behavior when override is explicitly provided

### Implementation Steps:

1. **Modify `src/session/prompt.ts` lines 602-628**:

   ```typescript
   async function resolveSystemPrompt(input: {
     system?: string;
     appendSystem?: string;
     agent: Agent.Info;
     providerID: string;
     modelID: string;
   }) {
     // CHANGE: When full system override provided, use ONLY that
     if (input.system) {
       return [input.system];
     }

     // Existing logic (unchanged) for when no override
     let system = SystemPrompt.header(input.providerID);
     system.push(
       ...(() => {
         const base = input.agent.prompt
           ? [input.agent.prompt]
           : SystemPrompt.provider(input.modelID);
         if (input.appendSystem) {
           return [base[0] + '\n' + input.appendSystem];
         }
         return base;
       })()
     );
     system.push(...(await SystemPrompt.environment()));
     system.push(...(await SystemPrompt.custom()));

     const [first, ...rest] = system;
     system = [first, rest.join('\n')];
     return system;
   }
   ```

2. **Add comment explaining the change**:

   ```typescript
   // When --system-message is provided, use it exclusively without any
   // additional context (no environment, no custom instructions, no header).
   // This is critical for models with low token limits (e.g., qwen3-32b with 6K TPM).
   ```

3. **Test locally**:

   ```bash
   echo '{"message":"What is 2 + 2?"}' | bun run src/index.js \
     --model groq/qwen/qwen3-32b \
     --system-message "You are helpful." \
     2>&1 | tee test-output.log
   ```

4. **Verify token count** in logs/error messages

5. **Run full test suite**:

   ```bash
   node scripts/test-model-simple.mjs groq/qwen/qwen3-32b
   ```

6. **Commit and push** to trigger CI

### Expected Results:

**Before fix**:

- Tokens requested: 9,059
- Result: HTTP 413 error

**After fix**:

- System message: "You are a helpful AI assistant. Answer questions accurately and concisely." (~17 tokens)
- User message: "What is 2 + 2? Answer with just the number." (~15 tokens)
- **Total: ~32 tokens**
- Result: ✅ Success

### Rollback Plan:

If this causes issues for other use cases:

1. Revert the change
2. Implement Solution 1, Option B (--no-environment flag) instead
3. Or implement Solution 2 (ultra-minimal prompt file)

---

## Alternative: Quick Verification Experiment

Before implementing the full fix, create a debug script to verify where tokens are coming from:

```javascript
// experiments/debug-tokens.mjs
import { Session } from '../src/session/index.ts';
import { SessionPrompt } from '../src/session/prompt.ts';
import { Instance } from '../src/project/instance.ts';

await Instance.provide({
  directory: process.cwd(),
  fn: async () => {
    const session = await Session.createNext({ directory: process.cwd() });

    // Capture what system prompt is generated
    console.log('Testing with --system-message override:');
    const systemWithOverride = await SessionPrompt.resolveSystemPrompt({
      system: 'You are helpful.',
      agent: await Agent.get('build'),
      providerID: 'groq',
      modelID: 'qwen/qwen3-32b',
    });
    console.log('System prompt components:', systemWithOverride.length);
    console.log(
      'Estimated tokens:',
      systemWithOverride.join('\n').length / 3.5
    );

    console.log('\nTesting without override:');
    const systemWithoutOverride = await SessionPrompt.resolveSystemPrompt({
      agent: await Agent.get('build'),
      providerID: 'groq',
      modelID: 'qwen/qwen3-32b',
    });
    console.log('System prompt components:', systemWithoutOverride.length);
    console.log(
      'Estimated tokens:',
      systemWithoutOverride.join('\n').length / 3.5
    );

    await Instance.dispose();
  },
});
```

This will tell us exactly what's being generated.

---

## Testing Checklist

After implementing the fix:

- [ ] Local test with `--system-message` override passes
- [ ] Token count confirmed < 1,000 in logs
- [ ] CI test for qwen3-32b passes
- [ ] No regression for normal models (without override)
- [ ] No regression for models with `--append-system-message`
- [ ] Documentation updated if behavior changes

---

## Conclusion

The most likely issue is that the environment and/or qwen.txt are still being included despite the `--system-message` override. The proposed Solution 1, Option A provides the cleanest fix with minimal risk and clear semantics.

If that doesn't resolve it, the debug experiment will definitively identify where the 9,059 tokens are coming from.
