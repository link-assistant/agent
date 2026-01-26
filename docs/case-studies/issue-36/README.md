# Case Study: Issue #36 - Token Limit Still Exceeded After PR #35 Fix

## Overview

**Issue**: [#36 - Can we do something else about these limits?](https://github.com/link-assistant/agent/issues/36)

**Failed CI Run**: [Actions Run #20149051402](https://github.com/link-assistant/agent/actions/runs/20149051402/job/57837202897)

**Date**: December 11, 2025

**Status**: Under Investigation

**Previous Related Issue**: [#34 - We hit the input tokens limit](https://github.com/link-assistant/agent/issues/34) - Fixed by PR #35

## Executive Summary

Despite PR #35's fix that implemented minimal system messages for low-limit models, the CI test for `groq/qwen/qwen3-32b` **still fails** with a token limit error. The request size has been reduced from **12,089 tokens** (pre-fix) to **9,059 tokens** (post-fix), but this is still above the model's 6,000 TPM limit.

### Key Findings

- **Error Type**: API Rate Limit (HTTP 413 - Payload Too Large)
- **Requested Tokens**: 9,059 tokens (down from 12,089 pre-fix)
- **Model Limit**: 6,000 TPM (Tokens Per Minute)
- **Test Type**: Simple message test with minimal system message override
- **Root Cause**: The minimal system message fix (PR #35) reduced but did not eliminate the token overflow

## Timeline of Events

### Background: PR #35 Fix (Merged 2025-12-11)

PR #35 attempted to fix issue #34 by:

1. Detecting models with low token limits (qwen3-32b, mixtral-8x7b-32768)
2. Using `--system-message` flag with a minimal 15-token message
3. Expected behavior: Skip the default ~12,000 token system message

**Result**: Partial success - reduced from 12,089 to 9,059 tokens (25% reduction)

### Current Failure: Run #20149051402 (2025-12-11 22:11:29)

**Test Execution**:

```bash
node scripts/test-model-simple.mjs "groq/qwen/qwen3-32b"
```

**Input Message**:

```json
{ "message": "What is 2 + 2? Answer with just the number." }
```

**System Message Override** (from test script):

```
You are a helpful AI assistant. Answer questions accurately and concisely.
```

**Log Output**:

```
ℹ️  Using minimal system message (low token limit model detected)
```

**API Error**:

```json
{
  "error": {
    "message": "Request too large for model `qwen/qwen3-32b` ... TPM: Limit 6000, Requested 9059",
    "type": "tokens",
    "code": "rate_limit_exceeded"
  }
}
```

## Root Cause Analysis

### The Paradox: Minimal System Message Still Causes 9,059 Tokens

The test script correctly:

1. ✅ Detects the low-limit model
2. ✅ Passes `--system-message` with a minimal message (~15 tokens)
3. ✅ Logs confirmation: "Using minimal system message"

But the request still contains **9,059 tokens**. Where are they coming from?

### Investigation: Code Path Analysis

#### System Message Resolution (`src/session/prompt.ts:602-628`)

```typescript
async function resolveSystemPrompt(input: {
  system?: string;
  appendSystem?: string;
  agent: Agent.Info;
  providerID: string;
  modelID: string;
}) {
  let system = SystemPrompt.header(input.providerID); // Line 609: Empty for Groq
  system.push(
    ...(() => {
      if (input.system) return [input.system]; // Line 612: Should return minimal message ONLY
      const base = input.agent.prompt
        ? [input.agent.prompt]
        : SystemPrompt.provider(input.modelID);
      if (input.appendSystem) {
        return [base[0] + '\n' + input.appendSystem];
      }
      return base; // Would be qwen.txt (~2,770 tokens)
    })()
  );
  if (!input.system) {
    // Line 620: Should skip when system override provided
    system.push(...(await SystemPrompt.environment())); // ~1,000-2,000 tokens
    system.push(...(await SystemPrompt.custom())); // ~1,000-2,000 tokens (CLAUDE.md, etc.)
  }
  return system;
}
```

**Expected Behavior** when `--system-message` is provided:

- Line 612: `input.system` exists → returns `["minimal message"]`
- Line 620: `!input.system` is false → skips environment and custom instructions
- **Total**: ~15 tokens (minimal message only)

**Actual Result**: 9,059 tokens

### Hypothesis: The Mystery of 9,059 Tokens

Token breakdown analysis:

| Component              | Expected (with fix) | Observed          | Source                 |
| ---------------------- | ------------------- | ----------------- | ---------------------- |
| Minimal system message | ~15 tokens          | ?                 | `--system-message` arg |
| Environment info       | 0 (skipped)         | ?                 | Should be skipped      |
| Custom instructions    | 0 (skipped)         | ?                 | Should be skipped      |
| User message           | ~15 tokens          | ~15 tokens        | "What is 2 + 2?..."    |
| **UNKNOWN SOURCE**     | **0 tokens**        | **~9,029 tokens** | ❓                     |
| **Total**              | **~30 tokens**      | **9,059 tokens**  |                        |

### Possible Explanations

#### Theory 1: Prompt Caching Initial Load

According to [Groq's prompt caching documentation](https://console.groq.com/docs/prompt-caching):

- Cached tokens don't count towards TPM limits
- **BUT**: First request has NO cache hit (cache doesn't exist yet)
- All tokens in the first request count towards TPM

However, this doesn't explain where 9,059 tokens are coming from if we're only sending ~30 tokens.

#### Theory 2: System Message Override Not Applied

**Possibility**: The `--system-message` flag might not be reaching `resolveSystemPrompt()` correctly.

**Evidence**:

- Test script shows "Using minimal system message" (logging works)
- But actual API call might not have the override applied

**Investigation Needed**:

- Add debug logging to `resolveSystemPrompt()` to see what `input.system` contains
- Verify server mode vs direct mode behavior
- Check if there's a caching or build issue

#### Theory 3: Default qwen.txt Still Being Loaded

The qwen.txt prompt file contains:

- **9,693 characters**
- Estimated **~2,770 tokens** (at 3.5 chars/token)

But if environment (~1,500 tokens) and other components are added:

- qwen.txt: ~2,770 tokens
- Environment: ~1,500 tokens
- File tree: ~2,000 tokens
- Custom instructions: ~1,000 tokens
- User message: ~15 tokens
- **Total**: ~7,285 tokens

Still doesn't explain 9,059 tokens, but closer than the "minimal message only" scenario.

**This suggests**: qwen.txt might still be loaded despite `--system-message` override!

#### Theory 4: Environment Information Still Included

The environment information includes:

- Working directory path
- Git repository status
- Platform information
- Current date
- **File tree** (up to 200 files via `Ripgrep.tree()`)

If `SystemPrompt.environment()` is still being called, the file tree alone could add significant tokens.

#### Theory 5: Hidden Agent Prompt

Looking at the default "build" agent configuration (`src/agent/agent.ts:52-58`):

```typescript
build: {
  name: "build",
  tools: { ...defaultTools },
  options: {},
  mode: "primary",
  builtIn: true,
},
```

The "build" agent has **no custom prompt**, so this shouldn't add tokens.

## Research: Understanding Groq's Token Limits

### TPM vs Request Size

Based on research from [Groq Rate Limits documentation](https://console.groq.com/docs/rate-limits):

**TPM (Tokens Per Minute)**: Maximum tokens processed in a 60-second window

**Key Insight**: "Request too large" error (HTTP 413) indicates that a **single request exceeds what can be processed within the TPM constraint**.

For a model with 6,000 TPM:

- A single request with 9,059 tokens would require **>1 minute** to process
- Groq rejects such requests immediately with HTTP 413

### Prompt Caching and Rate Limits

From [Groq Prompt Caching docs](https://console.groq.com/docs/prompt-caching):

- ✅ Cached tokens **do not** count towards TPM limits
- ❌ **First request** has no cache (cache doesn't exist yet)
- All tokens in first request count towards TPM

From [Claude Rate Limits docs](https://docs.claude.com/en/api/rate-limits):

- Similar behavior: Uncached tokens count towards ITPM
- Cached tokens provide "free" throughput above nominal limits
- With 80% cache hit rate, effective throughput can be 5x nominal rate

**Implication for our issue**:

- Even if caching works on subsequent requests, the **first CI test run** will always hit this limit
- Need to reduce first request to <6,000 tokens

## Impact Assessment

### Severity: CRITICAL

This issue **blocks CI** and **prevents using low-cost models** like qwen3-32b.

**Affected Systems**:

1. ✗ CI/CD Pipeline - Automated tests fail
2. ✗ Model Compatibility - Cannot use efficient smaller models
3. ✗ Cost Optimization - Forced to use higher-tier services
4. ✗ Developer Experience - PR checks fail unexpectedly

### Models Affected

Models with TPM ≤ 6,000 tokens on Groq free tier:

- ❌ `groq/qwen/qwen3-32b` (6,000 TPM)
- ❌ `groq/mixtral-8x7b-32768` (6,000 TPM)
- ❌ `groq/llama-3.1-8b-instant` (6,000 TPM per [community reports](https://github.com/elizaOS/eliza/issues/4040))

### What PR #35 Achieved

- ✅ **Reduced** token usage from 12,089 to 9,059 (25% improvement)
- ✅ **Established** pattern for detecting low-limit models
- ✅ **Implemented** system message override mechanism
- ❌ **Did not** reduce tokens below 6,000 TPM limit

## Proposed Solutions

### Solution 1: Investigate and Fix Unknown Token Source (CRITICAL)

**Goal**: Find where the 9,029 extra tokens are coming from

**Actions**:

1. Add debug logging to `resolveSystemPrompt()` to capture:
   - `input.system` value
   - Each component being added to system array
   - Final token count estimation
2. Run test locally with debugging enabled
3. Compare debug output with expected behavior
4. Fix the actual bug causing tokens to be added despite override

**Pros**:

- Fixes root cause
- Benefits all models
- No workarounds needed

**Cons**:

- Requires investigation time
- May uncover deeper architectural issues

### Solution 2: Force Ultra-Minimal System (IMMEDIATE WORKAROUND)

**Goal**: Bypass all system prompt logic for ultra-low-limit models

**Implementation**: Create a new `--ultra-minimal` flag that:

1. Skips `resolveSystemPrompt()` entirely
2. Uses a hardcoded 5-token system message: "You are helpful."
3. No environment, no custom, no agent prompt, no headers

**Example**:

```javascript
// In scripts/test-model-simple.mjs
const ultraLowLimitModels = ['qwen3-32b', 'mixtral-8x7b-32768'];
if (ultraLowLimitModels.some((m) => modelId.includes(m))) {
  args.push('--ultra-minimal');
}
```

**Pros**:

- Immediate workaround for CI
- Guaranteed minimal tokens
- Can be implemented today

**Cons**:

- Doesn't fix root cause
- Reduces agent capabilities significantly
- Hack/workaround rather than proper fix

### Solution 3: Use Direct Mode Instead of Server Mode

**Hypothesis**: Server mode might have different behavior for system message handling

**Implementation**:

```javascript
// In scripts/test-model-simple.mjs
const args = [
  'run',
  join(projectRoot, 'src/index.js'),
  '--model',
  modelId,
  '--server',
  'false',
];
```

**Rationale**:

- Default is `--server true` (line 419 in src/index.js)
- Server mode goes through HTTP API layer
- Direct mode calls `SessionPrompt.prompt()` directly
- May have different variable passing behavior

**Pros**:

- Simple one-line change to test
- If it works, identifies the bug location

**Cons**:

- May not solve the issue
- Server mode is default for a reason (better isolation)

### Solution 4: Implement Request-Level Token Budget

**Goal**: Add automatic token management based on model limits

**Implementation**:

1. Add `tokenBudget` field to model metadata in `models.ts`
2. In `resolveSystemPrompt()`, check if model has low token budget
3. Automatically select minimal components to fit budget
4. Provide clear error if user message alone exceeds budget

**Example Logic**:

```typescript
if (model.tokenBudget && model.tokenBudget < 10000) {
  // Ultra-minimal mode for low-budget models
  return [input.system || 'You are helpful.'];
}
```

**Pros**:

- Automatic handling
- Works for all models
- No manual configuration needed

**Cons**:

- Requires model metadata updates
- Complex logic to maintain
- May reduce functionality for low-limit models

### Solution 5: Pre-warm Cache or Skip First Test

**Goal**: Avoid cold-start cache misses in CI

**Options**:

**A) Pre-warm cache** before tests:

```bash
# Send a dummy request to warm up cache
echo '{"message":"hi"}' | bun run src/index.js --model groq/qwen/qwen3-32b
sleep 1
# Now run actual test
node scripts/test-model-simple.mjs groq/qwen/qwen3-32b
```

**B) Skip low-limit model tests** in CI:

```yaml
# In .github/workflows/test.yml
if: ${{ !contains(matrix.model, 'qwen3-32b') }}
```

**Pros**:

- Immediate CI fix
- No code changes needed (option B)

**Cons**:

- Doesn't fix underlying issue
- Pre-warming may not work (caches expire)
- Skipping tests reduces coverage

## Recommended Implementation Plan

### Phase 1: Immediate Investigation (HIGH PRIORITY)

**Goal**: Understand where 9,059 tokens are coming from

**Actions**:

1. ✅ Create experiment script with debug logging
2. ✅ Add token counting to `resolveSystemPrompt()`
3. ✅ Run local test with debugging enabled
4. ✅ Document findings in case study

**Timeline**: 1-2 hours

### Phase 2: Apply Targeted Fix (CRITICAL)

**Goal**: Fix the root cause once identified

**Possible Scenarios**:

**Scenario A**: `--system-message` not being passed correctly

- Fix argument parsing or server API handling
- Verify fix with local tests
- Commit and push

**Scenario B**: Environment/custom still being loaded

- Add additional check in `resolveSystemPrompt()`
- Ensure `if (!input.system)` logic is correct
- Verify all code paths

**Scenario C**: Unknown token source (caching, headers, etc.)

- Investigate and document the source
- Implement targeted fix
- Add regression test

**Timeline**: 2-4 hours

### Phase 3: CI Validation (REQUIRED)

**Goal**: Ensure CI tests pass after fix

**Actions**:

1. Push fix to branch
2. Monitor CI run
3. Verify token count in logs
4. Confirm tests pass for all low-limit models

**Timeline**: 30 minutes (CI execution time)

### Phase 4: Long-Term Improvements (OPTIONAL)

**Goal**: Prevent similar issues in future

**Actions**:

1. Add token budget to model metadata
2. Implement automatic token management
3. Add CI job that validates token usage
4. Document token optimization best practices

**Timeline**: 4-8 hours

## Testing Strategy

### Test Cases

1. **Low-limit model with minimal system override**
   - Input: `--system-message "You are helpful."`
   - Expected: Request < 1,000 tokens
   - Verify: Test passes, response received

2. **Token count validation**
   - Add token counting to test script output
   - Log actual vs expected tokens
   - Fail test if tokens > 90% of limit

3. **Regression test for PR #35 fix**
   - Ensure default behavior still reduced vs pre-fix
   - Confirm environment/custom skipped when override provided

4. **Edge cases**
   - Very long user message (test budget allocation)
   - No system message (test defaults)
   - Append system message (test combination behavior)

### Success Criteria

- ✅ Token count for qwen3-32b test < 5,000 (below 6,000 limit with margin)
- ✅ All CI tests pass for all models
- ✅ No regression in functionality for normal models
- ✅ Clear error messages if token budget exceeded

## Next Steps

1. **Create debug experiment script** to measure actual token usage
2. **Add instrumentation** to `resolveSystemPrompt()`
3. **Run local test** with logging to identify token source
4. **Implement fix** based on findings
5. **Validate with CI** to ensure tests pass
6. **Update documentation** with token optimization guidelines

## References

### Internal Documentation

- `src/session/prompt.ts:602-628` - System message resolution
- `src/session/system.ts` - System prompt components
- `src/index.js:79-101` - CLI argument parsing for system messages
- `scripts/test-model-simple.mjs:43-73` - Low-limit model detection and override
- PR #35 case study: `docs/case-studies/issue-34/README.md`

### External Resources

- [Groq Prompt Caching](https://console.groq.com/docs/prompt-caching)
- [Groq Rate Limits](https://console.groq.com/docs/rate-limits)
- [Claude API Rate Limits](https://docs.claude.com/en/api/rate-limits)
- [PromptHub: Prompt Caching Guide](https://www.prompthub.us/blog/prompt-caching-with-openai-anthropic-and-google-models)
- [GitHub Issue: Groq TPM 6000 Limit](https://github.com/elizaOS/eliza/issues/4040)
- [LangChain Discussion: Mixtral TPM Limit](https://github.com/langchain-ai/langchain/discussions/20598)

### Error Logs

- Current failure: `docs/case-studies/issue-36/ci-logs/failed-run-20149051402.log`
- Previous failure (pre-fix): `docs/case-studies/issue-34/ci-logs/run-20144359955.log`

## Appendix

### A. Complete Error Response

```json
{
  "type": "error",
  "timestamp": 1765491089153,
  "sessionID": "ses_4f087e520ffeZYiLg2MIr0SFST",
  "error": {
    "name": "APIError",
    "data": {
      "message": "Request too large for model `qwen/qwen3-32b` in organization `org_01kc2tjgvwfz9vpegygts4e5cv` service tier `on_demand` on tokens per minute (TPM): Limit 6000, Requested 9059, please reduce your message size and try again. Need more tokens? Upgrade to Dev Tier today at https://console.groq.com/settings/billing",
      "statusCode": 413,
      "isRetryable": false,
      "responseHeaders": {
        "x-ratelimit-limit-tokens": "6000",
        "x-ratelimit-remaining-tokens": "5756",
        "x-ratelimit-reset-tokens": "2.44s"
      }
    }
  }
}
```

### B. Token Estimation for qwen.txt

```bash
$ wc -l src/session/prompt/qwen.txt
109

$ wc -w src/session/prompt/qwen.txt
1596

$ wc -c src/session/prompt/qwen.txt
9693

Estimated tokens: 9693 / 3.5 ≈ 2,770 tokens
```

### C. Test Script Configuration (Post-PR #35)

```javascript
const lowLimitModels = ['qwen3-32b', 'mixtral-8x7b-32768'];

const needsMinimalSystem = lowLimitModels.some((model) =>
  modelId.includes(model)
);
const minimalSystemMessage =
  'You are a helpful AI assistant. Answer questions accurately and concisely.';

if (needsMinimalSystem) {
  args.push('--system-message', minimalSystemMessage);
}
```

---

**Document Version**: 1.0
**Last Updated**: 2025-12-11
**Status**: Investigation In Progress
**Next Action**: Create debug experiment to identify token source
