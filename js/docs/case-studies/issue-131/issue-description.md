# Issue #131: Agent CLI outputs stderr instead of stdout

## Issue Description

From GitHub issue link-assistant/agent#131:

**Title:** Agent CLI outputs stderr instead of stdout

**Description:**
link-assistant/hive-mind#1163 - here it is claimed, that our CLI agent does output everything to stderr, instead of stdout, please double check that, and make sure we do output everything except from errors to stdout by default. Also by default all errors and other output should be only in JSON (except may be from input mirroring of user input, but after user enters some input we still need to confirm it in the format we actually get from user, so once user presses enter or confirms the input in interactive mode we should also put JSON version of it in output, just to confirm how we got it and how we will send it to AI API).

Anyway all JSON output should have `type` field, for example:

```
{
  "type": "status",
  "mode": "stdin-stream",
  "message": "Agent CLI in continuous listening mode. Accepts JSON and plain text input.",
  "hint": "Press CTRL+C to exit. Use --help for options.",
  "acceptedFormats": [
    "JSON object with \"message\" field",
    "Plain text"
  ],
  "options": {
    "interactive": true,
    "autoMergeQueuedMessages": true,
    "alwaysAcceptStdin": true,
    "compactJson": false
  }
}
{"log":{"level":"info","timestamp":"2...
```

In here we can flatten (reduce nesting) all log statements as `{ "type": "log", "level":"info", "timestamp":"...`.

Also I think log statements also should be formatted as all other JSON output by default (and that should be configurable, like it is with all other output).

Please download all logs and data related about the issue to this repository, make sure we compile that data to `./docs/case-studies/issue-{id}` folder, and use it to do deep case study analysis (also make sure to search online for additional facts and data), in which we will reconstruct timeline/sequence of events, find root causes of the problem, and propose possible solutions.

## Metadata

- **Created:** Jan 23, 2026
- **Labels:** bug
- **Type:** Bug
- **Assignee:** None
- **Status:** Open
