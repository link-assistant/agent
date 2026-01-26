# Web Research Findings: Claude API Image Processing Failures

## Research Date

2025-12-16

## Related Issues Found on anthropics/claude-code Repository

### High Priority Issues

1. **Issue #1747** - "Could not process image" is a non-recoverable API error
   - Status: Closed as duplicate of #473
   - Impact: Session becomes completely unresponsive
   - Root cause: Corrupted/invalid image files sent to Anthropic API
2. **Issue #7122** - Claude Code Gets Stuck in Infinite Loop When Reading Invalid Image Files
   - Severity: Critical
   - Root causes identified:
     - Missing validation before API submission
     - Unbounded retries on 400 errors
     - Blocked user input during error states
     - Extension-based file type assumptions
3. **Issue #5106** - Read command fails with API error when file extension doesn't match content type
   - Problem: System relies on file extension rather than actual content detection
   - Proposed solutions:
     - Content-based detection using magic numbers
     - Graceful error handling
     - Fallback to text reading if image processing fails

### Additional Related Issues

- Issue #3659 - Image Processing Failure: API Error 400 with Invalid Image Request
- Issue #4471 - Image Processing Error: Invalid Request When Attempting to Analyze Image
- Issue #4777 - Image Processing API Error Handling Fails on Invalid Image Response
- Issue #6675 - API Error 400 "Could not process image"
- Issue #4624 - Image Processing Failure: 400 Error When Compacting Conversation
- Issue #2854 - Image Upload Failure: Invalid Request Error Processing Image
- Issue #3953 - failing to read a png or jpg and doesn't recover

## Common Patterns in Failures

### Root Causes

1. **Invalid file content**: Files with image extensions containing non-image data (HTML, JSON, text)
2. **Corrupted downloads**: GitHub attachment URLs returning 404 or error pages instead of images
3. **Base64 encoding issues**: Invalid or malformed base64 data sent to API
4. **No content validation**: System trusts file extensions without verifying actual content
5. **Small/truncated files**: Files too small to be valid images (e.g., 46 bytes = "Not Found" response)

### Impact

- **Non-recoverable state**: Session cannot continue after error occurs
- **Infinite loops**: System retries sending same invalid data
- **Lost work**: Forces complete application restart
- **No graceful degradation**: No fallback mechanism to continue without the image

## Proposed Solutions from Research

### 1. Pre-flight Validation

- Check magic bytes/file signatures before processing
- Verify actual content matches expected image format
- Validate base64 encoding integrity

### 2. Retry Limits

- Cap retry attempts (suggested: 3 max)
- Implement exponential backoff
- Log errors properly

### 3. Interrupt Handling

- Allow user to cancel stuck operations
- Respect "skip" or "cancel" commands immediately

### 4. Graceful Recovery

- Provide options: retry, skip, or read as text
- Don't send invalid data to API
- Handle errors locally when possible

### 5. Content-Based Detection

- Use libmagic or similar tools to detect actual file type
- Don't rely solely on file extensions
- Implement fallback to text reading for mismatched files

## Sources

- [Issue #1747 - "Could not process image" is a non-recoverable API error](https://github.com/anthropics/claude-code/issues/1747)
- [Issue #7122 - Claude Code Gets Stuck in Infinite Loop When Reading Invalid Image Files](https://github.com/anthropics/claude-code/issues/7122)
- [Issue #5106 - Read command fails with API error when file extension doesn't match content type](https://github.com/anthropics/claude-code/issues/5106)
