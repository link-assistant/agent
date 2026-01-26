# Case Study: Model grok-code Not Supported Error

**Issue ID:** #133
**Created:** 2026-01-25
**Status:** Resolved

## Resolution Summary

The issue has been resolved by changing the default model from `opencode/grok-code` to `opencode/gpt-5-nano`. The following changes were made:

1. **Default model changed** from `opencode/grok-code` to `opencode/gpt-5-nano` in all source files (JavaScript and Rust implementations)
2. **MODELS.md updated** to mark `grok-code` as a discontinued free model
3. **Documentation updated** (README.md, EXAMPLES.md, js/README.md, rust/README.md)
4. **Test files updated** to use the new default model
5. **Provider priority list updated** to put free models (`gpt-5-nano`, `big-pickle`) first

---

## Summary

When attempting to use the AI solver with the `--tool agent` option and the default `grok-code` model, the system returns a 401 error: "Model grok-code not supported". This occurs because xAI ended their free tier for the Grok Code Fast 1 model on OpenCode Zen around January 24, 2026.

## Timeline of Events

### Background (Before Incident)

| Date | Event |
|------|-------|
| August 2025 | xAI releases Grok Code Fast 1 (`grok-code-fast-1`) optimized for agentic coding |
| Late 2025 | OpenCode Zen adds Grok Code Fast 1 as a free model for users |
| - | The agent CLI sets `opencode/grok-code` as the default model due to its zero cost |

### Incident Timeline

| Timestamp (UTC) | Event |
|-----------------|-------|
| 2026-01-24 | xAI ends free tier for Grok Code Fast 1 on OpenCode Zen |
| 2026-01-24 | [GitHub Issue #10348](https://github.com/anomalyco/opencode/issues/10348) reports model disappearance |
| 2026-01-25T16:09:54Z | User `konard` starts solve session for issue #37 using Claude Opus (works successfully) |
| 2026-01-25T16:14:32Z | First solution draft completed with ~$3.18 cost |
| 2026-01-25T18:17:56Z | User `kogeletey` provides feedback on PR #38 |
| 2026-01-25T18:18:25Z | Solve session starts with `--tool agent` (uses grok-code by default) |
| 2026-01-25T18:18:44Z | API returns error: "Model grok-code not supported" with 401 status |
| 2026-01-25T18:18:49Z | Session terminates without completing any work |

## Root Cause Analysis

### Primary Cause: xAI Business Decision

The error is not a technical bug but a result of a business/policy change:

1. **xAI ended the free tier** for Grok Code Fast 1 on OpenCode Zen
2. The OpenCode Zen API now returns 401 Unauthorized for `grok-code` model requests
3. The agent CLI's default model configuration still points to `opencode/grok-code`

### Contributing Factors

1. **No advance notice** - Users received no warning before the model was removed
2. **Default model configuration** - The agent CLI uses `grok-code` as its default, making all unspecified model requests fail
3. **No fallback mechanism** - The system has no automatic fallback to alternative free models

### Error Details

```json
{
  "type": "error",
  "error": {
    "name": "APIError",
    "data": {
      "message": "Model grok-code not supported",
      "statusCode": 401,
      "isRetryable": false,
      "responseBody": "{\"type\":\"error\",\"error\":{\"type\":\"ModelError\",\"message\":\"Model grok-code not supported\"}}"
    }
  }
}
```

**Key observations:**
- HTTP 401 indicates authentication/authorization failure
- `isRetryable: false` means retry logic won't help
- Error type is `ModelError`, not a network or rate limit error

## Impact Assessment

### Affected Functionality

| Component | Impact |
|-----------|--------|
| `agent` CLI default behavior | Completely broken |
| `solve` with `--tool agent` | Cannot execute |
| Documentation (MODELS.md) | Outdated/misleading |
| User expectations | Free tier no longer available |

### Scope

- All users relying on the default `grok-code` model
- Automated systems configured without explicit model selection
- CI/CD pipelines using agent without `--model` flag

## Solutions

### Immediate Workarounds

#### 1. Use Alternative Free Models (Recommended)

```bash
# Use GPT 5 Nano (currently free)
echo "hello" | agent --model opencode/gpt-5-nano

# Use Big Pickle (currently free)
echo "hello" | agent --model opencode/big-pickle
```

#### 2. Use Paid Models on OpenCode Zen

```bash
# Use Claude Haiku 3.5 (affordable paid option)
echo "hello" | agent --model opencode/claude-haiku-3-5

# Use Claude Sonnet 4.5 (high quality)
echo "hello" | agent --model opencode/sonnet
```

#### 3. Use Direct Provider Access

```bash
# Use Anthropic directly (requires API key)
export ANTHROPIC_API_KEY=your_key
echo "hello" | agent --model anthropic/claude-sonnet-4

# Use Groq (requires API key, has free tier)
export GROQ_API_KEY=your_key
echo "hello" | agent --model groq/llama-3.3-70b-versatile
```

### Long-Term Solutions

#### Solution 1: Update Default Model

Update the agent CLI to use a different free model as default:

**Pros:**
- Minimal code changes
- Immediate fix for all users

**Cons:**
- GPT 5 Nano or Big Pickle may not match Grok Code's quality
- Risk of same issue recurring if that model is also removed

#### Solution 2: Implement Model Availability Checking

Add a pre-flight check for model availability before starting sessions:

```typescript
async function checkModelAvailability(modelId: string): Promise<boolean> {
  try {
    // Make a minimal API call to verify model is available
    const response = await fetch(`${OPENCODE_API}/models/${modelId}/check`);
    return response.ok;
  } catch {
    return false;
  }
}
```

**Pros:**
- Early failure with clear error message
- Can suggest alternatives when model unavailable

**Cons:**
- Adds latency to session start
- Requires API support for availability endpoint

#### Solution 3: Implement Automatic Fallback Chain

Configure a fallback chain of models to try:

```typescript
const MODEL_FALLBACK_CHAIN = [
  'opencode/grok-code',      // Primary (if available)
  'opencode/gpt-5-nano',     // Free fallback #1
  'opencode/big-pickle',     // Free fallback #2
  'opencode/claude-haiku-3-5' // Paid fallback
];
```

**Pros:**
- Resilient to model removals
- Graceful degradation

**Cons:**
- May surprise users with different model behavior
- Paid fallback could incur unexpected costs

#### Solution 4: Add Model Status Monitoring

Implement proactive monitoring of model availability:

1. Periodic health checks on all configured models
2. Update documentation automatically when models become unavailable
3. Alert users/admins when model status changes

## Related Resources

### External References

- [Grok Code Fast 1 disappeared from OpenCode Zen - Issue #10348](https://github.com/anomalyco/opencode/issues/10348)
- [OpenCode Zen Documentation](https://opencode.ai/docs/zen/)
- [OpenCode Providers Documentation](https://opencode.ai/docs/providers/)
- [xAI API Documentation](https://docs.x.ai/docs/models)
- [OpenRouter Grok Code Fast 1](https://openrouter.ai/x-ai/grok-code-fast-1)

### Internal References

- [MODELS.md](/MODELS.md) - Current model documentation (needs update)
- [Claude OAuth Documentation](/docs/claude-oauth.md) - Alternative authentication method

## Files in This Case Study

| File | Description |
|------|-------------|
| `README.md` | This analysis document |
| `grok-code-error-log.txt` | Complete error log from failed session |
| `claude-solution-log.txt` | Log from successful Claude Opus session for comparison |

## Lessons Learned

1. **External dependencies can disappear without notice** - Free tier models from third parties can be removed at any time without advance warning to downstream users.

2. **Default configurations should be resilient** - Critical defaults (like the default model) should have fallback mechanisms or be set to the most stable option, not necessarily the cheapest.

3. **Monitor third-party service announcements** - Subscribe to OpenCode and xAI announcements to get advance notice of changes.

4. **Consider cost vs. reliability trade-offs** - Free models are cost-effective but may be less stable than paid options with SLAs.

5. **Document model alternatives clearly** - Users should easily find alternative models when their preferred option becomes unavailable.

## Recommendations

### Immediate Actions (Completed)

1. ✅ **Update MODELS.md** - Marked Grok Code Fast 1 as discontinued free model
2. ✅ **Change default model** - Updated to `opencode/gpt-5-nano` as the new default
3. 🔜 **Add clear error message** - When model is unavailable, suggest alternatives (future improvement)

### Future Improvements

1. **Implement model availability API** - Check model availability before starting sessions
2. **Add fallback chain** - Automatically try alternative models when primary fails
3. **Create status page** - Maintain a page showing current model availability
4. **Add deprecation warnings** - Warn users when using models that may be removed soon
