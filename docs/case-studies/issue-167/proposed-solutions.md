# Proposed Solutions for Issue #167

## Summary

The core problem is that even though `@link-assistant/agent` sets `maxRetries: 0` in the AI SDK's `streamText()` calls, rate limit errors are being retried by the AI SDK's internal retry mechanism before the agent's custom retry logic can handle them.

## Solution 1: Custom Fetch Wrapper with Retry Logic (Recommended)

### Approach

Create a custom `fetch` wrapper that intercepts all HTTP responses and handles retries according to the agent's time-based retry configuration, before the AI SDK's internal retry mechanism can interfere.

### Implementation

```typescript
// src/provider/retry-fetch.ts
import { SessionRetry } from '../session/retry';
import { Log } from '../util/log';

const log = Log.create({ service: 'retry-fetch' });

export function createRetryFetch(sessionID: string): typeof fetch {
  return async function retryFetch(
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> {
    let attempt = 0;
    const startTime = Date.now();
    const maxRetryTime = SessionRetry.getRetryTimeout();

    while (true) {
      attempt++;
      const response = await fetch(input, init);

      // Only handle rate limit errors (429)
      if (response.status !== 429) {
        return response;
      }

      // Check if we're within the global retry timeout
      const elapsed = Date.now() - startTime;
      if (elapsed >= maxRetryTime) {
        log.info(() => ({
          message: 'retry timeout exceeded in fetch wrapper',
          elapsed,
          maxRetryTime,
        }));
        return response; // Let the error bubble up
      }

      // Parse retry-after header
      const retryAfterHeader = response.headers.get('retry-after');
      let delay = SessionRetry.RETRY_INITIAL_DELAY * Math.pow(
        SessionRetry.RETRY_BACKOFF_FACTOR,
        attempt - 1
      );

      if (retryAfterHeader) {
        const parsed = parseFloat(retryAfterHeader);
        if (!isNaN(parsed)) {
          delay = parsed * 1000; // Convert seconds to ms
        }
      }

      // Cap delay to max retry delay
      delay = Math.min(delay, SessionRetry.getMaxRetryDelay());

      log.info(() => ({
        message: 'rate limited, retrying',
        attempt,
        delay,
        retryAfterHeader,
        elapsed,
        maxRetryTime,
      }));

      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  };
}
```

### Integration

Inject the custom fetch into provider options:

```typescript
// In CUSTOM_LOADERS for providers that need retry handling
opencode: async (input) => {
  return {
    autoload: true,
    options: {
      apiKey: hasKey ? undefined : 'public',
      fetch: createRetryFetch('default-session'), // Add retry wrapper
    },
  };
},
```

### Pros

- Full control over retry behavior at the HTTP level
- Respects retry-after headers from the server
- Works before AI SDK's internal retry kicks in
- Can be configured per-provider

### Cons

- Requires session ID context at fetch level (may need refactoring)
- Adds another layer of abstraction
- Need to handle abort signals properly

---

## Solution 2: Language Model Middleware

### Approach

Use the AI SDK's middleware feature to wrap `doStream`/`doGenerate` calls with custom retry logic.

### Implementation

```typescript
// src/provider/retry-middleware.ts
import { experimental_wrapLanguageModel } from 'ai';
import { SessionRetry } from '../session/retry';

export function withRetryMiddleware(model: LanguageModel, sessionID: string) {
  return experimental_wrapLanguageModel({
    model,
    middleware: {
      wrapStream: async ({ doStream, params }) => {
        let attempt = 0;
        const startTime = Date.now();
        const maxRetryTime = SessionRetry.getRetryTimeout();

        while (true) {
          try {
            return await doStream();
          } catch (error) {
            if (!isRateLimitError(error)) {
              throw error;
            }

            const elapsed = Date.now() - startTime;
            if (elapsed >= maxRetryTime) {
              throw error;
            }

            const delay = calculateDelay(error, attempt);
            attempt++;
            await sleep(delay);
          }
        }
      },
    },
  });
}
```

### Pros

- Uses official AI SDK extension point
- More semantic than fetch wrapper
- Can access model-specific error information

### Cons

- Middleware runs after AI SDK's initial retry attempts
- May not intercept all error types
- Experimental API subject to change

---

## Solution 3: Upgrade AI SDK + Configuration

### Approach

1. Upgrade to latest AI SDK version (6.0.86+) which includes better retry-after header support
2. Use the new retry configuration options when available

### Steps

1. Update `package.json`:
   ```json
   {
     "dependencies": {
       "ai": "^6.0.86"
     }
   }
   ```

2. Check if the new version provides `getRetryDelay` customization

### Pros

- Minimal code changes
- Upstream-supported solution
- Benefit from future improvements

### Cons

- May still not provide time-based global timeout
- Breaking changes possible
- Dependent on upstream roadmap

---

## Solution 4: Minimum Retry Interval Configuration

### Approach

Add configuration for minimum retry interval to ensure retries don't happen too quickly:

```typescript
// src/flag/flag.ts
export function MIN_RETRY_INTERVAL(): number {
  const val = getEnv(
    'LINK_ASSISTANT_AGENT_MIN_RETRY_INTERVAL',
    'AGENT_MIN_RETRY_INTERVAL'
  );
  return val ? parseInt(val, 10) * 1000 : 30000; // 30 seconds default
}
```

### Integration

In `session/retry.ts`:
```typescript
export function delay(error: MessageV2.APIError, attempt: number): number {
  // ... existing code ...

  // Ensure minimum interval
  const minInterval = Flag.MIN_RETRY_INTERVAL();
  return Math.max(calculatedDelay, minInterval);
}
```

### Pros

- Simple implementation
- User-configurable
- Works with existing retry system

### Cons

- Doesn't address the root cause (AI SDK internal retries)
- May not help if AI SDK exhausts retries before agent can intervene

---

## Recommended Implementation Order

1. **Immediate**: Implement Solution 4 (minimum retry interval) as a quick win
2. **Short-term**: Implement Solution 1 (custom fetch wrapper) for providers that frequently hit rate limits
3. **Medium-term**: Test Solution 3 (AI SDK upgrade) when new versions are available
4. **Long-term**: Contribute to AI SDK with Solution 2 patterns as production-ready middleware

---

## Related Existing Libraries

### For Custom Retry Logic

1. **[p-retry](https://www.npmjs.com/package/p-retry)** - Promise-based retry with exponential backoff
2. **[async-retry](https://www.npmjs.com/package/async-retry)** - Async/await retry with configurable delays
3. **[@lifeomic/attempt](https://github.com/lifeomic/attempt)** - Flexible retry strategies including time-based

### For Rate Limit Management

1. **[bottleneck](https://www.npmjs.com/package/bottleneck)** - Distributed rate limiter
2. **[p-queue](https://www.npmjs.com/package/p-queue)** - Promise queue with concurrency control

### For HTTP Request Management

1. **[got](https://www.npmjs.com/package/got)** - HTTP client with built-in retry support
2. **[axios-retry](https://www.npmjs.com/package/axios-retry)** - Axios plugin with retry-after support
