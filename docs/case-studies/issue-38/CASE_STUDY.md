# Case Study: Image Processing Failures in Claude API

**Issue**: https://github.com/link-assistant/agent/issues/38  
**Related Issue**: https://github.com/link-assistant/hive-mind/issues/597  
**Date**: 2025-12-16  
**Status**: Under Investigation and Implementation

## Executive Summary

This case study examines a critical bug affecting Claude Code CLI and related agent implementations where invalid or corrupted image files cause non-recoverable API errors when read via the Read tool. The error "Could not process image" (HTTP 400 from Anthropic API) crashes the agent session without graceful recovery, requiring complete restart and loss of context.

## Timeline of Events

### Initial Occurrence (2025-10-20)

- **16:47:20 UTC** - Agent attempts to fetch image from GitHub: `https://github.com/user-attachments/assets/e926d89f-d0f8-4e01-aaf3-e0a395149bf9`
- **16:47:20 UTC** - WebFetch tool returns 404 error (image URL is invalid/private)
- **16:47:40 UTC** - Fallback: Agent downloads via curl, receives 9-byte file containing "Not Found"
- **16:47:44 UTC** - Read tool processes `/tmp/design-screenshot.png` assuming it's an image (based on .png extension)
- **16:47:44 UTC** - Read tool encodes "Not Found" HTML as base64 and sends to Claude API as PNG image
- **16:47:45 UTC** - **CRASH**: Anthropic API returns error 400: "Could not process image"
- **Session terminated** - No recovery possible, all context lost

### Subsequent Failures

Multiple similar failures documented across different repositories:

- [hh-job-application-automation#125](https://github.com/konard/hh-job-application-automation/pull/125#issuecomment-3642365155)
- [sales-audit-agent#6](https://github.com/link-assistant/sales-audit-agent/pull/6#issuecomment-3643254991)
- [sales-audit-agent#22](https://github.com/link-assistant/sales-audit-agent/pull/22#issuecomment-3651928135)
- [hive-mind#918](https://github.com/link-assistant/hive-mind/issues/918)

### Workaround Discovery (2025-12-11)

- User konard identified the issue is "flaky/random" on Anthropic API side
- **Workaround**: Re-execute the same operation - sometimes succeeds on retry
- Success examples documented: [hh-job-application-automation#125](https://github.com/konard/hh-job-application-automation/pull/125#issuecomment-3643256555)

## Root Cause Analysis

### Primary Root Causes

1. **No Content Validation Before API Submission**
   - The Read tool trusts file extensions without verifying actual content
   - File is identified as image solely based on `.png` extension
   - No magic number/file signature validation
   - No size sanity checks (46-byte "Not Found" sent as image)

2. **Blind Base64 Encoding of Invalid Data**

   ```typescript
   // Current code in src/tool/read.ts:78-94
   const mime = file.type; // Trusts Bun's file.type (extension-based)
   return {
     attachments: [
       {
         type: 'file',
         mime,
         url: `data:${mime};base64,${Buffer.from(await file.bytes()).toString('base64')}`,
       },
     ],
   };
   ```

   - Actual content: `<!DOCTYPE html>\n<html>... Not Found ...`
   - Sent as: `data:image/png;base64,PCFET0NUWVBFIGR0bWw+...`
   - API correctly rejects this as invalid PNG

3. **No Error Recovery Mechanism**
   - Single API error terminates entire session
   - No fallback to read as text
   - No retry logic
   - No graceful degradation

### Contributing Factors

1. **GitHub Attachment URL Behavior**
   - Private repository attachments return 404 for unauthorized requests
   - 404 responses are HTML, not images
   - URLs look valid but content is error page

2. **Download Tool Limitations**
   - `curl` successfully downloads error pages
   - No HTTP status code validation
   - No content-type header verification

3. **Anthropic API Behavior**
   - Strict validation of image data
   - Immediate 400 error on invalid base64 image data
   - No partial processing or format detection
   - Reportedly "flaky" - sometimes processes borderline cases

## Technical Details

### File Signature Analysis

**Valid PNG File**:

- Magic bytes: `89 50 4E 47 0D 0A 1A 0A` (first 8 bytes)
- Header structure required
- Minimum size: ~67 bytes for valid PNG

**Actual Downloaded "Image"** (base64 decoded):

```html
<!DOCTYPE html>
<html>
  <head>
    <title>Not Found</title>
  </head>
  <body>
    Not Found
  </body>
</html>
```

- Size: 9 bytes (after curl processing)
- Magic bytes: `3C 21 44 4F 43 54 59 50` (`<!DOCTYP`)
- Clearly HTML, not PNG

### Current Code Flow

```
1. User/AI requests to read image file
2. Read tool checks file extension → identifies as image
3. No content validation performed
4. File content read as bytes
5. Bytes base64-encoded
6. Sent to Claude API with mime type from extension
7. API validates image format → FAILS
8. Error propagates to user → SESSION CRASH
```

## Impact Assessment

### Severity: **Critical**

**Affected Systems**:

- Claude Code CLI (all versions)
- @link-assistant/agent
- Any OpenCode-compatible agent using similar Read tool implementation

**Impact Scope**:

- **User Experience**: Complete session loss, all context destroyed
- **Automation**: CI/CD pipelines fail with no recovery
- **Cost**: Wasted API calls and compute time
- **Trust**: Undermines reliability of autonomous agents

**Frequency**:

- Common when processing GitHub issues/PRs with images
- Affects private repositories more (attachment URLs fail)
- Intermittent due to "flaky" API behavior (sometimes works on retry)

## Related Research: Anthropic Claude Code Issues

### Critical Findings from anthropics/claude-code Repository

1. **Issue #1747**: "Could not process image" is a non-recoverable API error
   - Status: Closed as duplicate of #473
   - Root cause: Invalid image files sent to API
   - Impact: Complete session unresponsiveness

2. **Issue #7122**: Infinite Loop When Reading Invalid Image Files
   - Severity: Critical
   - Problems identified:
     - Missing validation before API submission
     - Unbounded retries on 400 errors
     - Blocked user input during error states
     - Extension-based file type assumptions
   - Proposed solutions:
     - Pre-flight validation with magic bytes
     - Retry limits (max 3 attempts)
     - Interrupt handling for user cancellation
     - Graceful recovery with options

3. **Issue #5106**: File Extension Mismatch Failures
   - Problem: System relies on extensions, not content detection
   - Solution: Content-based detection using libmagic equivalent
   - Fallback: Attempt text reading if image processing fails

### Common Patterns Across 10+ Related Issues

- Small/truncated files (< 100 bytes)
- Files with image extensions containing HTML/JSON/text
- Corrupted downloads from GitHub
- Base64 encoding issues
- No validation before API calls

## Proposed Solutions

### Solution 1: Pre-flight Image Validation (Recommended)

**Implementation**: Add magic byte validation before encoding

```typescript
function validateImageFile(bytes: Uint8Array, expectedType: string): boolean {
  if (bytes.length < 8) return false;

  const signatures = {
    PNG: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    JPEG: [0xff, 0xd8, 0xff],
    GIF: [0x47, 0x49, 0x46, 0x38], // GIF8
    WebP: [0x52, 0x49, 0x46, 0x46], // RIFF (need to check WEBP at offset 8)
    BMP: [0x42, 0x4d],
  };

  const sig = signatures[expectedType];
  if (!sig) return false;

  for (let i = 0; i < sig.length; i++) {
    if (bytes[i] !== sig[i]) return false;
  }

  return true;
}
```

**Pros**:

- Catches 100% of invalid images before API call
- No API cost for validation failures
- Fast (checks only first few bytes)
- No external dependencies

**Cons**:

- Requires maintaining signature database
- Won't catch corrupted-but-valid-header files

### Solution 2: Try-Catch with Fallback to Text

**Implementation**: Wrap image processing, fallback to text on failure

```typescript
try {
  // Attempt image processing
  return processAsImage(file);
} catch (error) {
  if (error.message.includes('Could not process image')) {
    // Fallback: read as text
    return processAsText(file);
  }
  throw error;
}
```

**Pros**:

- Graceful degradation
- Still provides file content to user
- Simple implementation

**Cons**:

- Wastes one API call on failure
- Doesn't prevent the error, just handles it
- May expose binary data as garbled text

### Solution 3: Add `--verify-images-at-read-tool` Flag

**Implementation**: Optional strict validation mode

```typescript
const config = {
  verifyImagesAtReadTool: process.env.VERIFY_IMAGES_AT_READ_TOOL !== 'false',
};

if (isImage && config.verifyImagesAtReadTool) {
  const bytes = await file.bytes();
  if (!validateImageFile(bytes, expectedFormat)) {
    throw new Error(
      `Image validation failed: ${filepath} has .${ext} extension but does not contain valid ${expectedFormat} data. ` +
        `Disable validation with VERIFY_IMAGES_AT_READ_TOOL=false`
    );
  }
}
```

**Pros**:

- Opt-out design (enabled by default)
- Clear error messages for users
- Can be disabled for edge cases

**Cons**:

- Adds configuration complexity
- May reject some edge-case valid files

### Solution 4: Pre-download Issue/PR Data as Markdown

**Implementation**: Download GitHub content before agent execution

```bash
# gh-issue-download tool
gh issue view 38 --json title,body,comments --jq '...' > issue-38.json
# Convert images to inline base64 or download locally
# Provide markdown to agent instead of HTML
```

**Pros**:

- Prevents runtime download failures
- Can validate images before agent sees them
- Faster agent execution (no download time)
- Works offline

**Cons**:

- Requires pre-processing step
- Doesn't solve general image reading problem
- Large repo of downloaded data

## Recommended Implementation Plan

### Phase 1: Immediate Fix (Week 1)

1. **Implement Solution 1 + 3**: Magic byte validation with opt-out flag
2. **Add comprehensive error messages**: Guide users on what went wrong
3. **Create tests**: Cover all image formats and common failure modes
4. **Document workaround**: Retry on failure (per konard's finding)

### Phase 2: Enhanced Recovery (Week 2)

5. **Implement Solution 2**: Fallback to text reading
6. **Add retry logic**: Max 3 attempts with exponential backoff
7. **Interrupt handling**: Allow user to cancel stuck operations

### Phase 3: Ecosystem Tools (Week 3)

8. **Create gh-issue-download**: Pre-fetch GitHub content
9. **Create gh-pr-download**: Pre-fetch PR data
10. **Integration guide**: Document best practices

## Testing Strategy

### Unit Tests

```javascript
test('Read tool rejects HTML file with .png extension', async () => {
  const htmlFile = 'tmp/fake-image.png';
  writeFileSync(htmlFile, '<!DOCTYPE html><html>Not Found</html>');

  const input = `{"message":"read file","tools":[{"name":"read","params":{"filePath":"${htmlFile}"}}]}`;
  const result = await $`echo ${input} | bun run src/index.js`.nothrow();

  const events = result.stdout.split('\n').map(JSON.parse);
  const errorEvent = events.find((e) => e.type === 'error');

  expect(errorEvent).toBeTruthy();
  expect(errorEvent.error.message).toContain('Image validation failed');
});
```

### Integration Tests

- Test with real GitHub attachment URLs (public)
- Test with 404 error pages
- Test with corrupted PNG files
- Test with valid images
- Test opt-out flag

### Manual Testing

- Run against hive-mind#597 scenario
- Verify graceful error messages
- Confirm fallback behavior
- Test retry workaround

## Success Criteria

1. **No Session Crashes**: Invalid images produce clear errors, not crashes
2. **Clear Error Messages**: Users understand what went wrong and how to fix it
3. **Graceful Degradation**: Fallback to text reading when possible
4. **Test Coverage**: 100% coverage of image validation code paths
5. **Documentation**: Clear guide on image handling and troubleshooting
6. **Backward Compatibility**: Opt-out flag allows disabling validation

## Alternative Approaches Considered

### Approach: Report Bug to Anthropic

**Decision**: Worth doing, but not a complete solution

- Issue appears known (multiple claude-code issues)
- "Flaky" behavior suggests server-side improvements possible
- However, we still need client-side validation (defense in depth)

### Approach: Use Different AI Provider

**Decision**: Not viable

- Issue is specific to how we send data to Claude API
- Problem is on our side (sending invalid data)
- Switching providers doesn't fix root cause

### Approach: Disable Image Support

**Decision**: Too restrictive

- Images are valuable for many use cases
- Would break legitimate functionality
- Better to fix properly than remove feature

## Lessons Learned

1. **Never trust file extensions**: Always validate actual content
2. **Fail fast with clear errors**: Better than cryptic API failures
3. **Defense in depth**: Validate early, handle errors gracefully
4. **Test edge cases**: 404 pages, tiny files, corrupted data
5. **Document workarounds**: Help users while permanent fix is developed

## References

### Primary Sources

- [agent#38](https://github.com/link-assistant/agent/issues/38) - This issue
- [hive-mind#597](https://github.com/link-assistant/hive-mind/issues/597) - Original failure report
- [hive-mind#918](https://github.com/link-assistant/hive-mind/issues/918) - Duplicate failure
- Failure log: [Gist](https://gist.githubusercontent.com/konard/98380265dbd31353c62bb5190a9cba1b/raw/f03ed37c38dbc64f8197246cc51caa8dfadc8ea3/solution-draft-log-pr-1765469858029.txt)

### Claude Code Issues (anthropics/claude-code)

- [#1747](https://github.com/anthropics/claude-code/issues/1747) - Non-recoverable API error
- [#7122](https://github.com/anthropics/claude-code/issues/7122) - Infinite loop on invalid images
- [#5106](https://github.com/anthropics/claude-code/issues/5106) - Extension mismatch failures
- [#3659, #4471, #4777, #6675, #4624, #2854, #3953](https://github.com/anthropics/claude-code/issues) - Related reports

### Technical Resources

- [PNG Specification](http://www.libpng.org/pub/png/spec/1.2/PNG-Structure.html) - File format details
- [File Signatures](https://en.wikipedia.org/wiki/List_of_file_signatures) - Magic number reference
- [Anthropic API Docs](https://docs.anthropic.com/claude/reference/messages_post) - Image handling

## Appendix: Data Collection

All logs, JSON files, and research findings have been preserved in:

```
./docs/case-studies/issue-38/
├── CASE_STUDY.md (this file)
├── web-research-findings.md
├── agent-38.json
├── agent-39.json
├── hive-mind-597.json
├── hive-mind-918.json
├── failure-log-918.txt
└── error-context.txt
```

---

**Document Version**: 1.0  
**Last Updated**: 2025-12-16  
**Author**: AI Agent (Claude Code)  
**Status**: Implementation in Progress
