# Case Study: Issue #136 - Simplify Installation

## Summary

A user reported that the installation process was confusing — after installing, the system indicated that environment variables needed to be added, but didn't explain how. The user compared this to OpenCode's installer, which automatically adds itself to `$PATH` and confirms with a message like `Successfully added opencode to $PATH in /home/username/.bashrc`. This case study reconstructs the timeline, identifies root causes, and proposes solutions.

## Issue Reference

- **Issue:** https://github.com/link-assistant/agent/issues/136
- **Reported by:** @andchir
- **Date:** 2026-01-26
- **Component:** Installation process for `@link-assistant/agent`
- **Runtime:** Bun

## Incident Timeline

| Time | Event |
|---|---|
| 2026-01-26 (initial report) | @andchir opens issue #136: "Need to simplify installation or provide more detailed information on how to complete it fully. Currently it says you need to add variables to the environment and that's it." References OpenCode's approach: `Successfully added opencode to $PATH in /home/username/.bashrc` |
| 2026-01-26 09:34 UTC | @konard responds asking for specifics and pointing to existing README installation instructions |
| 2026-01-26 11:08 UTC | @andchir replies: reinstalled Bun and agent cleanly, everything worked on second attempt. Provides full log showing successful installation |
| 2026-01-30 23:34 UTC | @konard requests: (1) Update READMEs for all implementations with clearer instructions, (2) Create case study with root cause analysis |

## Root Cause Analysis

### Primary Root Cause: Bun's `$PATH` configuration is a prerequisite that users may miss

When Bun is installed via `curl -fsSL https://bun.sh/install | bash`, it:
1. Installs `bun` binary to `~/.bun/bin/bun`
2. Adds `~/.bun/bin` to `$PATH` in the user's shell configuration file (e.g., `~/.bashrc`)
3. Prints instructions to `source` the shell configuration

**Critical step often missed:** The user must run `source ~/.bashrc` (or restart the terminal) for the `$PATH` changes to take effect. Without this step:
- `bun` command may not be found
- Globally installed packages (like `agent`) won't be found because `~/.bun/bin` is not in `$PATH`

This is a well-documented issue in the Bun ecosystem:
- [Global installation not adding the path (oven-sh/bun#7136)](https://github.com/oven-sh/bun/issues/7136)
- [`bun add --global` not working on macOS due to PATH (oven-sh/bun#5990)](https://github.com/oven-sh/bun/issues/5990)
- [Bun "command not found" after install (oven-sh/bun#13404)](https://github.com/oven-sh/bun/issues/13404)

### Contributing Factor: README did not emphasize the `source` step

The existing installation instructions in `js/README.md` included:

```bash
# Install Bun first if you haven't already
curl -fsSL https://bun.sh/install | bash

# Install the package globally
bun install -g @link-assistant/agent
```

The instructions did not highlight:
1. The need to run `source ~/.bashrc` (or restart the terminal) after installing Bun
2. How to verify Bun is properly installed before proceeding
3. What to do if the `agent` command is not found after installation

### Contributing Factor: Comparison with OpenCode's smoother UX

OpenCode uses a custom install script (`curl -fsSL https://opencode.ai/install | bash`) that:
- Downloads and installs the binary
- Automatically adds it to `$PATH` in the shell configuration
- Prints a clear confirmation: `Successfully added opencode to $PATH in /home/username/.bashrc`
- Makes the command available immediately (within the same script execution context)

Our agent relies on Bun's global install mechanism, which adds an extra dependency (Bun itself) and an extra `source` step that users may overlook.

Reference: [OpenCode Installation Docs](https://opencode.ai/docs/cli/) | [OpenCode install script PATH issue (#5884)](https://github.com/sst/opencode/issues/5884)

## Sequence of Events (Reconstructed)

```
User's First Attempt (Failed):
┌──────────────────────────────┐
│ 1. curl ... | bash           │  Bun installed to ~/.bun/bin
│    (Bun installer)           │  PATH updated in ~/.bashrc
│                              │  BUT current shell not reloaded
└──────────────┬───────────────┘
               │
               ▼ (possibly skipped: source ~/.bashrc)
┌──────────────────────────────┐
│ 2. bun install -g agent      │  May have worked (if bun was found)
│                              │  OR may have failed silently
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│ 3. agent --version           │  "command not found" or
│                              │  "need to add variables"
│                              │  (PATH not set in current shell)
└──────────────────────────────┘

User's Second Attempt (Succeeded):
┌──────────────────────────────┐
│ 1. curl ... | bash           │  Fresh Bun install
│    (Bun installer)           │
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│ 2. source ~/.bashrc          │  ← KEY STEP: reloads PATH
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│ 3. bun --version → 1.3.6    │  Bun confirmed working
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│ 4. bun install -g agent      │  Agent installed successfully
│    → agent@0.8.11            │
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│ 5. agent --version → 0.8.11  │  Working correctly
└──────────────────────────────┘
```

## Proposed Solutions

### Solution 1: Improve README installation instructions (Implemented)

Update all README files with step-by-step instructions that explicitly include:
1. The `source` step after Bun installation
2. Verification commands at each step (`bun --version`, `agent --version`)
3. A troubleshooting section for common PATH issues
4. Clear numbering of steps to prevent skipping

### Solution 2: Create a custom install script (Future consideration)

Create a `curl -fsSL https://link-assistant.github.io/agent/install | bash` script that:
- Installs Bun if not present
- Installs the agent package globally
- Verifies PATH configuration
- Prints a confirmation message similar to OpenCode's

**Known existing tools/approaches:**
- [OpenCode install script](https://opencode.ai/install) - Shell script that handles PATH configuration
- [Bun install script](https://bun.sh/install) - Already handles adding `~/.bun/bin` to PATH
- [nvm install script](https://github.com/nvm-sh/nvm) - Another example of proper PATH management in installers

### Solution 3: Provide alternative installation methods (Future consideration)

Offer additional installation methods that don't require Bun as a prerequisite:
- `npx @link-assistant/agent` (for Node.js users, if Node.js support is added)
- Pre-built binaries (like the Rust implementation, once complete)
- Docker image: `docker run -it link-assistant/agent`

## Impact Assessment

- **Severity:** Medium - Installation works, but the process can be confusing for new users
- **Frequency:** Affects first-time users who haven't used Bun before
- **Affected users:** New users installing the agent for the first time
- **Workaround:** Run `source ~/.bashrc` after Bun installation, or restart the terminal

## Files Changed

- `README.md` - Updated main README with clearer installation section
- `js/README.md` - Updated JavaScript README with step-by-step installation with verification
- `rust/README.md` - Updated Rust README with clearer prerequisite and installation steps

## References

- [Bun Installation Documentation](https://bun.sh/docs/installation)
- [Global installation not adding the path (oven-sh/bun#7136)](https://github.com/oven-sh/bun/issues/7136)
- [`bun add --global` not working on macOS (oven-sh/bun#5990)](https://github.com/oven-sh/bun/issues/5990)
- [Bun "command not found" after install (oven-sh/bun#13404)](https://github.com/oven-sh/bun/issues/13404)
- [OpenCode CLI Installation Docs](https://opencode.ai/docs/cli/)
- [OpenCode install script --no-modify-path request (#5884)](https://github.com/sst/opencode/issues/5884)
