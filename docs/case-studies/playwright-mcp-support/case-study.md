# Playwright MCP Support Case Study

## Issue Summary

**Title:** Support Playwright MCP
**URL:** https://github.com/link-assistant/agent/issues/16
**Status:** Open
**Author:** konard
**Labels:** documentation, enhancement
**Created:** 2025-12-05

**Objective:**
Implement support for Microsoft's Playwright MCP server in the link-assistant/agent CLI tool, with a command-line interface similar to Claude Code's `claude mcp add` command.

## Background

### What is Playwright MCP?

Playwright MCP is a Model Context Protocol (MCP) server developed by Microsoft that provides browser automation capabilities using Playwright. This server enables Large Language Models (LLMs) to interact with web pages through structured accessibility snapshots, bypassing the need for screenshots or visually-tuned models.

**Key Features:**

- **Fast and lightweight** - Uses Playwright's accessibility tree instead of pixel-based input
- **LLM-friendly** - No vision models needed; operates on structured data
- **Deterministic tool application** - Avoids ambiguity common with screenshot-based approaches

### Repository and Package

- **GitHub:** https://github.com/microsoft/playwright-mcp
- **NPM Package:** `@playwright/mcp`
- **Latest Version:** 0.0.49 (as of December 2025)
- **Requirements:** Node.js 18 or newer

## Current State Analysis

### Existing MCP Infrastructure

The link-assistant/agent project already has robust MCP support:

1. **Configuration Schema** (`src/config/config.ts`):
   - Supports both `local` and `remote` MCP server types
   - Local servers use command arrays: `["npx", "@playwright/mcp@latest"]`
   - Configuration stored in OpenCode-compatible JSON format

2. **MCP Client** (`src/mcp/index.ts`):
   - Uses `@ai-sdk/mcp` for MCP client creation
   - Supports `StdioClientTransport` for local commands
   - Handles connection, tool retrieval, and error states

3. **CLI Command** (`src/cli/cmd/mcp.ts`):
   - Has interactive `mcp add` command using `@clack/prompts`
   - Currently only supports interactive mode (not CLI arguments)

### Gap Analysis

The current implementation lacks:

1. **Non-interactive CLI command** - Cannot add MCP servers via command-line arguments
2. **Configuration persistence** - Interactive add doesn't save to config file
3. **Tests** - No tests for MCP add functionality
4. **CI integration** - No GitHub Actions workflow for MCP tests

## Proposed Solution

### Command Format

Following Claude Code's pattern:

```bash
agent mcp add <name> <command> [args...]
```

Example:

```bash
agent mcp add playwright npx @playwright/mcp@latest
```

### Expected Output Configuration

The command should produce configuration in the user's config directory:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "playwright": {
      "type": "local",
      "command": ["npx", "@playwright/mcp@latest"],
      "enabled": true
    }
  }
}
```

### Implementation Plan

1. **Modify `src/cli/cmd/mcp.ts`**:
   - Add positional arguments support to `McpAddCommand`
   - Support both interactive mode (no args) and CLI mode (with args)
   - Save configuration to user config file

2. **Update Configuration Handling**:
   - Ensure config persistence works with new command
   - Handle merging with existing MCP configurations

3. **Add Tests**:
   - Unit test for command parsing
   - Integration test for configuration file creation
   - Test MCP server connection (mock or actual Playwright MCP)

4. **GitHub Actions Workflow**:
   - Create workflow to run MCP tests on push/PR
   - Test both adding MCP server and verifying configuration

## Available Playwright MCP Tools

The Playwright MCP server exposes 22+ tools for browser automation:

| Tool                       | Description                    |
| -------------------------- | ------------------------------ |
| `browser_navigate`         | Navigate to a URL              |
| `browser_click`            | Click on an element            |
| `browser_type`             | Type text into an element      |
| `browser_snapshot`         | Capture accessibility snapshot |
| `browser_take_screenshot`  | Take a screenshot              |
| `browser_fill_form`        | Fill multiple form fields      |
| `browser_select_option`    | Select dropdown option         |
| `browser_hover`            | Hover over element             |
| `browser_drag`             | Drag and drop                  |
| `browser_evaluate`         | Execute JavaScript             |
| `browser_tabs`             | Manage browser tabs            |
| `browser_close`            | Close the browser              |
| `browser_wait_for`         | Wait for text/element          |
| `browser_press_key`        | Press keyboard key             |
| `browser_handle_dialog`    | Handle browser dialogs         |
| `browser_network_requests` | Get network requests           |
| `browser_console_messages` | Get console messages           |
| `browser_file_upload`      | Upload files                   |
| `browser_resize`           | Resize browser window          |
| `browser_navigate_back`    | Navigate back                  |
| `browser_install`          | Install browser                |
| `browser_run_code`         | Run Playwright code            |

## References

- [Playwright MCP GitHub Repository](https://github.com/microsoft/playwright-mcp)
- [Using Playwright MCP with Claude Code](https://til.simonwillison.net/claude-code/playwright-mcp-claude-code)
- [How to Integrate Playwright MCP for AI-Driven Test Automation](https://techcommunity.microsoft.com/blog/azuredevcommunityblog/how-to-integrate-playwright-mcp-for-ai-driven-test-automation/4470372)
- [MCP with Playwright Tutorial](https://kailash-pathak.medium.com/mcp-model-context-protocol-server-with-playwright-05d751387e53)
- [Microsoft Developer Blog - Complete Playwright Story](https://developer.microsoft.com/blog/the-complete-playwright-end-to-end-story-tools-ai-and-real-world-workflows)

## Data Files

- `issue-16.json` - Original issue data
- `playwright-mcp-research.json` - Research data about Playwright MCP
