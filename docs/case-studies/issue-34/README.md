# Case Study: Issue #34 - Input Tokens Limit Exceeded

## Overview

**Issue**: [#34 - We hit the input tokens limit](https://github.com/link-assistant/agent/issues/34)

**Failed CI Run**: [Actions Run #20144359955](https://github.com/link-assistant/agent/actions/runs/20144359955/job/57820526807)

**Date**: December 11, 2025

**Status**: Under Investigation

## Executive Summary

The CI test for model `groq/qwen/qwen3-32b` failed with a rate limit error indicating that the request size (12,089 tokens) exceeded the model's tokens per minute (TPM) limit of 6,000 tokens. This failure occurred during a simple "2 + 2" test that should require minimal tokens, indicating that the **system message** being sent to the model is excessively large.

### Key Findings

- **Error Type**: API Rate Limit (HTTP 413)
- **Requested Tokens**: 12,089 tokens
- **Model Limit**: 6,000 TPM (Tokens Per Minute)
- **Test Type**: Simple message test (no tool calls)
- **Root Cause**: Excessively large system message assembled from multiple sources

## Timeline of Events

### 1. Test Execution (2025-12-11 19:07:24)

The CI workflow executed `scripts/test-model-simple.mjs` with the following parameters:

```bash
node scripts/test-model-simple.mjs "groq/qwen/qwen3-32b"
```

**Input Message**:

```json
{ "message": "What is 2 + 2? Answer with just the number." }
```

### 2. Model Invocation (2025-12-11 19:07:24-26)

The agent attempted to send a request to the Groq API with:

- **Provider**: `groq`
- **Model**: `qwen/qwen3-32b`
- **User Message**: "What is 2 + 2? Answer with just the number."
- **System Message**: ~12,089 tokens (assembled automatically)

### 3. API Rejection (2025-12-11 19:07:26)

Groq API returned error:

```json
{
  "error": {
    "message": "Request too large for model `qwen/qwen3-32b` in organization `org_01kc2tjgvwfz9vpegygts4e5cv` service tier `on_demand` on tokens per minute (TPM): Limit 6000, Requested 12089, please reduce your message size and try again.",
    "type": "tokens",
    "code": "rate_limit_exceeded"
  }
}
```

**Response Headers**:

- `x-ratelimit-limit-tokens`: 6000
- `x-ratelimit-remaining-tokens`: 5774
- `retry-after`: 64
- HTTP Status: 413 (Payload Too Large)

### 4. Test Failure (2025-12-11 19:07:26)

The test script detected the error and exited with code 1:

```
❌ Test FAILED: Agent exited with code 1
```

## Root Cause Analysis

### System Message Assembly Process

The system message is assembled in `src/session/prompt.ts:resolveSystemPrompt()` (lines 603-629):

```typescript
async function resolveSystemPrompt(input: {
  system?: string;
  appendSystem?: string;
  agent: Agent.Info;
  providerID: string;
  modelID: string;
}) {
  let system = SystemPrompt.header(input.providerID);
  system.push(
    ...(() => {
      if (input.system) return [input.system];
      const base = input.agent.prompt
        ? [input.agent.prompt]
        : SystemPrompt.provider(input.modelID);
      if (input.appendSystem) {
        return [base[0] + '\n' + input.appendSystem];
      }
      return base;
    })()
  );
  if (!input.system) {
    system.push(...(await SystemPrompt.environment()));
    system.push(...(await SystemPrompt.custom()));
  }
  // max 2 system prompt messages for caching purposes
  const [first, ...rest] = system;
  system = [first, rest.join('\n')];
  return system;
}
```

### Components Contributing to Token Usage

When **no `--system-message` override** is provided, the system message includes:

1. **Header Prompt** (`SystemPrompt.header(providerID)`)
   - Usually empty unless using Anthropic provider
   - Source: `src/session/system.ts:22-25`

2. **Main Provider Prompt** (`SystemPrompt.provider(modelID)`)
   - For `qwen/qwen3-32b`, uses: `PROMPT_ANTHROPIC_WITHOUT_TODO`
   - Source: `src/session/system.ts:27-35`
   - Estimated size: **~8,000-9,000 tokens**

3. **Environment Information** (`SystemPrompt.environment()`)
   - Working directory
   - Git repository status
   - Platform information
   - Current date
   - **File tree** (up to 200 files via `Ripgrep.tree()`)
   - Source: `src/session/system.ts:37-60`
   - Estimated size: **~1,000-2,000 tokens**

4. **Custom Instructions** (`SystemPrompt.custom()`)
   - Reads `CLAUDE.md`, `AGENTS.md`, `CONTEXT.md`
   - Reads files from global config directories
   - Reads files specified in config `instructions`
   - Source: `src/session/system.ts:62-119`
   - Estimated size: **~1,000-2,000 tokens**

### Token Breakdown

| Component           | Estimated Tokens   | Purpose                          |
| ------------------- | ------------------ | -------------------------------- |
| Header Prompt       | 0-100              | Provider-specific initialization |
| Main Prompt         | 8,000-9,000        | Agent behavior instructions      |
| Environment         | 1,000-2,000        | Context about working directory  |
| Custom Instructions | 1,000-2,000        | Repository-specific rules        |
| **Total**           | **~10,000-13,000** | **Complete system message**      |

The actual measurement of **12,089 tokens** aligns with this analysis.

## Impact Assessment

### Severity: HIGH

This issue affects:

1. **CI/CD Pipeline**: Automated tests fail for models with low token limits
2. **Model Compatibility**: Cannot use smaller/cheaper models effectively
3. **Cost Efficiency**: Forces use of higher-tier models or services
4. **User Experience**: CLI fails silently when token limits are exceeded

### Affected Models

Models with TPM limits ≤ 6,000 tokens on free tiers:

- `groq/qwen/qwen3-32b` (6,000 TPM on free tier)
- `groq/mixtral-8x7b-32768` (6,000 TPM on free tier)
- Other Groq free-tier models

## Research: Industry Best Practices

### Token Limit Standards (2025)

According to [Groq API Rate Limits](https://console.groq.com/docs/rate-limits):

- Free tier models typically have 6,000 TPM limits
- Paid tiers scale without rate limits
- Rate limit headers (`x-ratelimit-limit-tokens`) inform current limits

### System Message Optimization Best Practices

Research from multiple sources reveals:

1. **Prompt Optimization** ([LLM Cost Optimization Guide](https://www.deepchecks.com/5-approaches-to-solve-llm-token-limits/))
   - Remove polite or redundant language
   - Use structured outputs instead of long prose
   - Can reduce token usage by up to 35%

2. **Context Caching** ([Token Compression Strategies](https://medium.com/@yashpaddalwar/token-compression-how-to-slash-your-llm-costs-by-80-without-sacrificing-quality-bfd79daf7c7c))
   - Cache static portions of system messages
   - Reuse across requests
   - Particularly effective for unchanged instructions

3. **Batching and Compression** ([Stop Wasting LLM Tokens](https://towardsdatascience.com/stop-wasting-llm-tokens-a5b581fb3e6e/))
   - Tools like LLMLingua can compress prompts by up to 20x
   - Remove noise and redundant tokens automatically
   - Can achieve 60-80% cost reduction

4. **Minimal System Messages** ([Token Efficiency Guide](https://portkey.ai/blog/optimize-token-efficiency-in-prompts/))
   - Include only essential context
   - Remove verbose explanations
   - Favor concise, clear instructions

## Proposed Solutions

### Solution 1: Add CLI Option to Override System Message (RECOMMENDED)

**Status**: ✅ Already implemented in `src/index.js`

The CLI already supports:

- `--system-message <text>`: Full override of system message
- `--system-message-file <path>`: Override from file
- `--append-system-message <text>`: Append to default
- `--append-system-message-file <path>`: Append from file

**Implementation**: Update test script to use `--system-message` for models with low token limits.

**Pros**:

- No code changes required
- Immediate solution
- Full control over system message

**Cons**:

- Requires manual intervention for each test
- Doesn't solve the underlying issue

### Solution 2: Implement Automatic Token Budget Management

**Description**: Add logic to automatically reduce system message size based on model token limits.

**Implementation Steps**:

1. Add token limit detection in `src/provider/provider.ts`
2. Create system message variants (minimal, standard, full)
3. Auto-select variant based on model's token budget
4. Add configuration option for token budget strategy

**Pros**:

- Automatic handling
- Works for all models
- Maintains compatibility

**Cons**:

- Requires significant code changes
- Complexity in maintaining variants

### Solution 3: Conditional Environment/Custom Instructions

**Description**: Make environment and custom instructions optional based on CLI flags or model capabilities.

**Implementation Steps**:

1. Add `--minimal-system` flag to CLI
2. Skip `SystemPrompt.environment()` when flag is set
3. Skip `SystemPrompt.custom()` when flag is set
4. Document usage in README

**Pros**:

- Simple implementation
- Backward compatible
- User has control

**Cons**:

- Loses valuable context
- May affect agent performance

### Solution 4: Compress System Messages

**Description**: Implement automatic compression of system messages using techniques like LLMLingua.

**Implementation Steps**:

1. Add compression library (e.g., LLMLingua)
2. Compress system messages before sending
3. Add `--compress-system` flag
4. Cache compressed versions

**Pros**:

- Maintains full context
- Significant token reduction (up to 80%)
- Modern approach

**Cons**:

- Additional dependency
- Processing overhead
- May affect prompt clarity

### Solution 5: Model-Specific System Message Templates

**Description**: Create optimized system message templates for different model families.

**Implementation Steps**:

1. Create minimal templates for low-limit models
2. Add template selection logic in `SystemPrompt.provider()`
3. Maintain template variants in `src/session/prompt/`
4. Document template selection rules

**Pros**:

- Optimized for each model
- No runtime overhead
- Predictable behavior

**Cons**:

- Maintenance burden
- Template proliferation

## Recommended Implementation Plan

### Phase 1: Immediate Fix (Use Existing CLI Options)

**Goal**: Make CI tests pass immediately

**Actions**:

1. Update `scripts/test-model-simple.mjs` to detect models with low token limits
2. Use `--system-message` flag with minimal message for these models
3. Document the approach in test script comments

**Example**:

```javascript
const lowLimitModels = ['groq/qwen/qwen3-32b', 'groq/mixtral-8x7b-32768']
const useMinimalSystem = lowLimitModels.some(m => modelId.includes(m))

const args = ['run', join(projectRoot, 'src/index.js'), '--model', modelId]
if (useMinimalSystem) {
  args.push('--system-message', 'You are a helpful AI assistant. Answer questions concisely.')
}

const agent = spawn('bun', args, { ... })
```

### Phase 2: Medium-Term Solution (Automatic Detection)

**Goal**: Automatically handle token limits without manual configuration

**Actions**:

1. Add model token limit metadata to provider registry
2. Implement automatic system message sizing
3. Add `--system-budget` CLI option for manual override
4. Update documentation

### Phase 3: Long-Term Optimization (Compression)

**Goal**: Optimize token usage across all models

**Actions**:

1. Research and evaluate compression libraries
2. Implement optional compression for system messages
3. Add caching for compressed messages
4. Benchmark performance and quality impact

## Testing Strategy

### Test Cases

1. **Low-limit model with default system**
   - Should detect limit and use minimal system
   - Should complete successfully

2. **Low-limit model with override**
   - Should use provided system message
   - Should validate token count

3. **High-limit model with full system**
   - Should use complete system message
   - Should maintain all functionality

4. **Edge cases**
   - Very large custom instructions
   - Missing model metadata
   - Compression failures

### Success Criteria

- ✅ All CI tests pass for all models
- ✅ No regressions in agent functionality
- ✅ Documentation is complete and clear
- ✅ Token usage is optimized (< 80% of limit)

## References

### Internal Documentation

- `src/session/system.ts` - System message construction
- `src/session/prompt.ts` - Prompt assembly and resolution
- `src/index.js` - CLI argument parsing
- `scripts/test-model-simple.mjs` - Test script

### External Resources

- [Groq Rate Limits](https://console.groq.com/docs/rate-limits)
- [Groq Pricing](https://groq.com/pricing)
- [Qwen3-32B Documentation](https://console.groq.com/docs/model/qwen/qwen3-32b)
- [LLM Token Optimization Guide](https://www.deepchecks.com/5-approaches-to-solve-llm-token-limits/)
- [Token Compression Strategies](https://medium.com/@yashpaddalwar/token-compression-how-to-slash-your-llm-costs-by-80-without-sacrificing-quality-bfd79daf7c7c)
- [Stop Wasting LLM Tokens](https://towardsdatascience.com/stop-wasting-llm-tokens-a5b581fb3e6e/)
- [Token Efficiency Best Practices](https://portkey.ai/blog/optimize-token-efficiency-in-prompts/)

## Appendix

### A. Complete Error Response

```json
{
  "type": "error",
  "timestamp": 1765480046313,
  "sessionID": "ses_4f1306513ffei1ALM5byg64CF8",
  "error": {
    "name": "APIError",
    "data": {
      "message": "Request too large for model `qwen/qwen3-32b` in organization `org_01kc2tjgvwfz9vpegygts4e5cv` service tier `on_demand` on tokens per minute (TPM): Limit 6000, Requested 12089, please reduce your message size and try again. Need more tokens? Upgrade to Dev Tier today at https://console.groq.com/settings/billing",
      "statusCode": 413,
      "isRetryable": false,
      "responseHeaders": {
        "x-ratelimit-limit-tokens": "6000",
        "x-ratelimit-remaining-tokens": "5774",
        "retry-after": "64",
        "x-request-id": "req_01kc7cz7jyfj3bw1j0x2fmw01k"
      }
    }
  }
}
```

### B. CI Logs

See: `docs/case-studies/issue-34/ci-logs/run-20144359955.log`

### C. Code References

- System message assembly: `src/session/prompt.ts:603-629`
- System prompt components: `src/session/system.ts:21-138`
- CLI options: `src/index.js:401-416`
- Test script: `scripts/test-model-simple.mjs`

---

**Document Version**: 1.0
**Last Updated**: 2025-12-11
**Authors**: AI Issue Solver
