# Timeline: Issue #51 - System Message Override Bug

## Event Sequence

### User Execution

**Timestamp:** 2025-12-16T13:25:40 +42ms

```bash
echo "Which tools you have enabled?" | agent \
  --model anthropic/claude-sonnet-4-5 \
  --system-message "" \
  --verbose
```

### System Boot Sequence (13:25:40)

1. **+42ms** - Instance creation
   - Service: default
   - Directory: /Users/konard
   - Creating instance

2. **+1ms** - Project detection
   - Service: project
   - Directory: /Users/konard
   - fromDirectory

3. **+13ms** - HTTP Request initiated
   - Service: server
   - Method: POST
   - Path: /session
   - Status: started

4. **+2ms** - Session created
   - Service: session
   - ID: ses_4d8a9786bffehkwqIxSJiaxG1R
   - Version: agent-cli-1.0.0
   - Project ID: global
   - Directory: /Users/konard
   - Title: New session - 2025-12-16T13:25:40.884Z

5. **+3ms** - Configuration loading
   - Service: config
   - Paths checked:
     - /Users/konard/.config/opencode/config.json
     - /Users/konard/.config/opencode/opencode.json
     - /Users/konard/.config/opencode/opencode.jsonc

### Prompt Processing Loop (13:25:40)

6. **Session prompt loop initiated**
   - Service: session.prompt
   - Step: 0
   - Session ID: ses_4d8a9786bffehkwqIxSJiaxG1R

7. **Provider initialization**
   - Service: provider
   - Status: started (state)
   - Duration: 5ms
   - Using Anthropic OAuth credentials check
   - Provider ID: anthropic found
   - Provider ID: opencode found

8. **Model resolution**
   - Provider ID: anthropic
   - Model ID: claude-sonnet-4-5
   - Model found and validated

### Verbose Debug Output (13:25:40)

9. **API Request Details Logged**

   ```
   === VERBOSE: API Request Details ===
   Model: anthropic/claude-sonnet-4-5
   Session ID: ses_4d8a9786bffehkwqIxSJiaxG1R
   Agent: build
   Temperature: default
   Top P: default
   Active Tools: bash, read, glob, grep, list, edit, write, task, webfetch, websearch, codesearch, batch, todowrite, todoread
   ```

10. **🐛 BUG MANIFESTS: System Prompt Output**

    ```
    --- System Prompt ---
    System Message 1 (14 tokens estimated):
    You are Claude Code, Anthropic's official CLI for Claude.

    System Message 2 (2107 tokens estimated):
    You are OpenCode, the best coding agent on the planet.
    [... full default prompt ...]
    ```

    **Expected:** Only empty string (0 tokens)
    **Actual:** Two system messages with 2121 total tokens

11. **Token Summary**
    ```
    System prompt tokens (estimated): 2121
    User message tokens (estimated): 7
    Total estimated tokens: 2128
    Model context limit: 200000
    Model output limit: 64000
    ```

### Code Execution Flow

#### Entry Point → Bug Location

```
1. src/index.js:144
   ├─ Parse CLI argument: systemMessage = ""
   └─ Pass to runDirectMode/runServerMode

2. src/index.js:479 (or server equivalent)
   ├─ SessionPrompt.prompt({
   │    sessionID,
   │    parts,
   │    model: { providerID: "anthropic", modelID: "claude-sonnet-4-5" },
   │    system: "",  ← Empty string passed here
   │    appendSystem: undefined
   │  })

3. src/session/prompt.ts:193-204 (prompt function)
   ├─ Create user message
   └─ Call loop(sessionID)

4. src/session/prompt.ts:232-671 (loop function)
   ├─ Line 478: Call resolveSystemPrompt({
   │              system: "",  ← Still empty string
   │              appendSystem: undefined,
   │              agent,
   │              providerID: "anthropic",
   │              modelID: "claude-sonnet-4-5"
   │            })

5. src/session/prompt.ts:697-730 (resolveSystemPrompt function)
   ├─ Line 707: 🐛 BUG OCCURS HERE
   │   if (input.system) {  ← Evaluates to FALSE for ""
   │     return [input.system];  ← This line is SKIPPED
   │   }
   ├─ Line 711: system = SystemPrompt.header("anthropic")
   │   └─ Returns: ["You are Claude Code, Anthropic's official CLI for Claude."]
   ├─ Lines 712-722: system.push(SystemPrompt.provider(...))
   │   └─ Adds: ["You are OpenCode, the best coding agent on the planet. [...]"]
   ├─ Line 723: system.push(environment())
   ├─ Line 724: system.push(custom())
   ├─ Lines 727-728: Merge to 2 messages for caching
   └─ Return: ["Message 1 (14 tokens)", "Message 2 (2107 tokens)"]

6. src/session/prompt.ts:622-628
   └─ Convert to ModelMessage array and send to API
```

### API Request & Response (13:25:40 to 13:25:52)

12. **Request sent to Anthropic API**
    - Service: session.processor
    - Process initiated
    - System messages: 2 (incorrect)
    - Total tokens: 2128

13. **Streaming response** (13:25:42 to 13:25:52)
    - Multiple message.part.updated events
    - Tool listing response generated
    - Step finish at 13:25:52

14. **Session idle** (13:25:52)
    - Service: session.prompt
    - Session ID: ses_4d8a9786bffehkwqIxSJiaxG1R
    - Exiting loop
    - Total cost: 0
    - Tokens: input=3, output=329, cache.read=12001

## Critical Bug Moment

**Time:** 13:25:40 (during prompt processing)
**Location:** src/session/prompt.ts:707
**Condition:** `if (input.system)` where `input.system === ""`

```javascript
// What happened:
if ('') {
  // Evaluates to false (empty string is falsy)
  return ['']; // This line was NOT executed
}
// Execution continued to build default prompt

// What should have happened:
if ('' !== undefined) {
  // Evaluates to true
  return ['']; // This line SHOULD be executed
}
// Execution should stop here and return empty string
```

## Impact Timeline

- **User expectation:** System message overridden with empty string (0 tokens)
- **Actual behavior:** Default system prompt used (2121 tokens)
- **Difference:** 2121 extra tokens sent unnecessarily
- **Result:** Unable to test with truly minimal context or use low-token-limit models

## Resolution Path

1. **Immediate:** One-line fix in src/session/prompt.ts:707
2. **Testing:** Verify all three cases (undefined, empty, custom)
3. **Commit:** Push fix to issue-51-bf685c43c881 branch
4. **Update PR:** Mark PR #52 as ready for review

## Timestamps Summary

| Time         | Event                                            |
| ------------ | ------------------------------------------------ |
| 13:25:40.042 | User command executed                            |
| 13:25:40.043 | Instance created                                 |
| 13:25:40.044 | Project detection                                |
| 13:25:40.057 | Session created (ses_4d8a9786bffehkwqIxSJiaxG1R) |
| 13:25:40.060 | Config loading                                   |
| 13:25:40.061 | Session prompt loop started (step 0)             |
| 13:25:40.064 | Provider initialization                          |
| 13:25:40.105 | Model resolution complete                        |
| 13:25:40.113 | **🐛 Bug manifests: Wrong system prompt logged** |
| 13:25:40.114 | API request sent                                 |
| 13:25:44.224 | Step start event                                 |
| 13:25:52.648 | Text response complete                           |
| 13:25:52.765 | Step finish event                                |
| 13:25:52.768 | Session idle                                     |
| 13:25:52.769 | Session compaction pruning                       |
| 13:25:52.771 | Loop exit                                        |

Total execution time: ~12.7 seconds
Bug manifestation: At 113ms into execution
