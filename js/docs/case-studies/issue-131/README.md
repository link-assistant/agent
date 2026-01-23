# Issue 131 Case Study: Agent CLI outputs stderr instead of stdout

## Issue Description

The Agent CLI was outputting all JSON output to stderr instead of stdout, except for errors which should remain on stderr. The issue required ensuring that all non-error output goes to stdout by default, while maintaining JSON formatting for all output.

## Root Cause Analysis

The problem was in the output routing:

1. The `json-standard/index.ts` event handler was correctly routing non-error events to stdout and errors to stderr.
2. However, the `cli/output.ts` `output` function was also routing based on type, but since events were already handled by the event handler, this was redundant.
3. The Log system was correctly outputting to stdout.

The issue was that the event handler was routing correctly, but perhaps in some cases it was not, or the output.ts was overriding.

## Solution Implemented

1. Modified `src/json-standard/index.ts` to always output events to stdout (since errors are handled separately via outputError).
2. Modified `src/cli/output.ts` to always output messages to stdout, consolidating all JSON output to stdout.

## Files Changed

- `src/json-standard/index.ts`: Changed outputStream to always `process.stdout`
- `src/cli/output.ts`: Modified `output` function to always use `writeStdout`

## Test Results

- Before: Output was going to stderr
- After: All output goes to stdout, maintaining JSON format with `type` fields

## Data Collected

- `stdout.txt`: Contains the JSON output from a test run
- `stderr.txt`: Empty, confirming no output to stderr

## Timeline

- Issue reported: Jan 23, 2026
- Analysis: Identified output routing issue
- Fix implemented: Changed output streams to stdout
- Verification: Test run shows output to stdout
